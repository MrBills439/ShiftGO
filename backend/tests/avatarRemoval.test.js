process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const storage = require('../src/lib/storage');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const uploadAvatar = (u) =>
  request(app).post('/users/me/avatar').set('Authorization', `Bearer ${tokenFor(u)}`)
    .attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' });
const removeAvatar = (u) =>
  request(app).delete('/users/me/avatar').set('Authorization', `Bearer ${tokenFor(u)}`);

let agencyA;
let agencyB;
let workerA;
let workerB;
const strayFiles = [];

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `AvRm A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `AvRm B ${suffix}` } });
  workerA = await prisma.user.create({ data: { agencyId: agencyA.id, role: 'WORKER', name: 'AvRm A', email: `avrm-a-${suffix}@shiftgo.test`, passwordHash: 'x' } });
  workerB = await prisma.user.create({ data: { agencyId: agencyB.id, role: 'WORKER', name: 'AvRm B', email: `avrm-b-${suffix}@shiftgo.test`, passwordHash: 'x' } });
});

afterAll(async () => {
  for (const f of strayFiles) { try { fs.unlinkSync(f); } catch { /* noop */ } }
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.user.update({ where: { id: workerA.id }, data: { profilePicture: null } });
});

describe('DELETE /users/me/avatar', () => {
  test('requires authentication', async () => {
    expect((await request(app).delete('/users/me/avatar')).status).toBe(401);
  });

  test('removes the caller’s own avatar: column null + physical file deleted', async () => {
    const up = await uploadAvatar(workerA);
    expect(up.status).toBe(200);
    const webPath = up.body.data.profilePicture;
    const abs = storage.resolveStoredPath(webPath);
    expect(fs.existsSync(abs)).toBe(true);

    const res = await removeAvatar(workerA);
    expect(res.status).toBe(200);
    expect(res.body.data.profilePicture).toBeNull();
    expect((await prisma.user.findUnique({ where: { id: workerA.id } })).profilePicture).toBeNull();
    expect(fs.existsSync(abs)).toBe(false);
  });

  test('is safe when there is no avatar to remove', async () => {
    const res = await removeAvatar(workerA);
    expect(res.status).toBe(200);
    expect(res.body.data.profilePicture).toBeNull();
  });

  test('is safe when the physical file is already gone', async () => {
    const up = await uploadAvatar(workerA);
    const abs = storage.resolveStoredPath(up.body.data.profilePicture);
    fs.unlinkSync(abs); // file vanishes out from under us
    const res = await removeAvatar(workerA);
    expect(res.status).toBe(200);
    expect(res.body.data.profilePicture).toBeNull();
  });

  test('a tampered "../" profilePicture value cannot delete a file outside AVATARS_DIR', async () => {
    // Plant a file in the RTW dir and point the avatar column at it via "../".
    const victim = path.join(storage.RTW_DIR, `victim-${suffix}.pdf`);
    fs.mkdirSync(storage.RTW_DIR, { recursive: true });
    fs.writeFileSync(victim, '%PDF-1.4 keep me');
    strayFiles.push(victim);
    await prisma.user.update({
      where: { id: workerA.id },
      data: { profilePicture: `/uploads/avatars/../rtw/victim-${suffix}.pdf` },
    });

    const res = await removeAvatar(workerA);
    expect(res.status).toBe(200);
    expect(res.body.data.profilePicture).toBeNull();      // column still cleared
    expect(fs.existsSync(victim)).toBe(true);             // but the RTW file is untouched
  });

  test('the endpoint only ever touches the caller — no way to target another user', async () => {
    // workerB has an avatar; workerA calling DELETE must not affect it.
    const up = await uploadAvatar(workerB);
    const abs = storage.resolveStoredPath(up.body.data.profilePicture);
    strayFiles.push(abs);

    await removeAvatar(workerA);

    expect((await prisma.user.findUnique({ where: { id: workerB.id } })).profilePicture).toBe(up.body.data.profilePicture);
    expect(fs.existsSync(abs)).toBe(true);

    await prisma.user.update({ where: { id: workerB.id }, data: { profilePicture: null } });
  });
});
