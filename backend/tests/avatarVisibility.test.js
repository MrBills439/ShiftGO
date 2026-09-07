process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const fs = require('fs');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const storage = require('../src/lib/storage');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG signature — enough for the mime/ext filter

let agencyA;
let agencyB;
let workerA;
let hrA;
let managerA;
let teamLeaderA;
let managerB;
const writtenAvatars = [];

async function mkUser(agencyId, role, tag) {
  return prisma.user.create({
    data: { agencyId, role, name: `Avatar ${tag}`, email: `avatar-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x' },
  });
}

function uploadAvatar(user) {
  return request(app)
    .post('/users/me/avatar')
    .set('Authorization', `Bearer ${tokenFor(user)}`)
    .attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' });
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Avatar A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `Avatar B ${suffix}` } });
  workerA = await mkUser(agencyA.id, 'WORKER', 'workerA');
  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  managerA = await mkUser(agencyA.id, 'MANAGER', 'managerA');
  teamLeaderA = await mkUser(agencyA.id, 'TEAM_LEADER', 'tlA');
  managerB = await mkUser(agencyB.id, 'MANAGER', 'managerB');
});

afterAll(async () => {
  for (const p of writtenAvatars) {
    const abs = storage.resolveStoredPath(p);
    if (abs) { try { fs.unlinkSync(abs); } catch { /* noop */ } }
  }
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

describe('avatar visibility across roles', () => {
  test('a worker can upload an avatar and see it on their own profile', async () => {
    const res = await uploadAvatar(workerA);
    expect(res.status).toBe(200);
    expect(res.body.data.profilePicture).toMatch(/^\/uploads\/avatars\/[0-9a-f]+\.png$/);
    writtenAvatars.push(res.body.data.profilePicture);
  });

  test('HR, Manager and Team Leader all receive the avatar URL for that worker', async () => {
    for (const staff of [hrA, managerA, teamLeaderA]) {
      const list = await request(app)
        .get('/users').query({ role: 'WORKER' })
        .set('Authorization', `Bearer ${tokenFor(staff)}`);
      expect(list.status).toBe(200);
      const row = list.body.data.find((u) => u.id === workerA.id);
      expect(row).toBeTruthy();
      expect(row.profilePicture).toMatch(/^\/uploads\/avatars\//);
    }

    const detail = await request(app)
      .get(`/users/${workerA.id}`)
      .set('Authorization', `Bearer ${tokenFor(hrA)}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.profilePicture).toMatch(/^\/uploads\/avatars\//);
  });

  test('replacing the avatar produces a new URL (no indefinitely-stale image)', async () => {
    const first = (await prisma.user.findUnique({ where: { id: workerA.id } })).profilePicture;
    const res = await uploadAvatar(workerA);
    expect(res.status).toBe(200);
    writtenAvatars.push(res.body.data.profilePicture);
    expect(res.body.data.profilePicture).not.toBe(first);
  });

  test('agency isolation: another agency cannot see or fetch the worker', async () => {
    const list = await request(app)
      .get('/users').query({ role: 'WORKER' })
      .set('Authorization', `Bearer ${tokenFor(managerB)}`);
    expect(list.status).toBe(200);
    expect(list.body.data.find((u) => u.id === workerA.id)).toBeUndefined();

    const detail = await request(app)
      .get(`/users/${workerA.id}`)
      .set('Authorization', `Bearer ${tokenFor(managerB)}`);
    expect(detail.status).toBe(404);
  });
});
