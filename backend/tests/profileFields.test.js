process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });

let agency;
let worker;

beforeAll(async () => {
  agency = await prisma.agency.create({ data: { name: `Profile ${suffix}` } });
  worker = await prisma.user.create({
    data: {
      agencyId: agency.id, role: 'WORKER',
      name: 'Real Name', email: `profile-worker-${suffix}@shiftgo.test`, passwordHash: 'x',
      contractedHours: 37.5, phone: null, address: null,
    },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
  await prisma.user.deleteMany({ where: { agencyId: agency.id } });
  await prisma.agency.delete({ where: { id: agency.id } });
  await prisma.$disconnect();
});

const me = () => request(app).get('/users/me').set('Authorization', `Bearer ${tokenFor(worker)}`);
const patchMe = (body) => request(app).patch('/users/me').set('Authorization', `Bearer ${tokenFor(worker)}`).send(body);

describe('GET/PATCH /users/me — worker profile fields', () => {
  test('GET /users/me returns contractedHours for the worker', async () => {
    const res = await me();
    expect(res.status).toBe(200);
    expect(res.body.data.contractedHours).toBe(37.5);
    expect(res.body.data.name).toBe('Real Name');
    expect(res.body.data.email).toBe(`profile-worker-${suffix}@shiftgo.test`);
  });

  test('phone and address updates persist', async () => {
    const res = await patchMe({ phone: '+44 7700 900123', address: '9 Elm Road, Leeds' });
    expect(res.status).toBe(200);

    const after = (await me()).body.data;
    expect(after.phone).toBe('+44 7700 900123');
    expect(after.address).toBe('9 Elm Road, Leeds');
  });

  test('email, contractedHours, role and status are read-only via /users/me', async () => {
    await patchMe({
      email: 'hacker@evil.test',
      contractedHours: 1,
      role: 'HR',
      status: 'DEACTIVATED',
    });
    const after = (await me()).body.data;
    expect(after.email).toBe(`profile-worker-${suffix}@shiftgo.test`);
    expect(after.contractedHours).toBe(37.5);
    expect(after.role).toBe('WORKER');
    expect(after.status).toBe('ACTIVE');
  });
});
