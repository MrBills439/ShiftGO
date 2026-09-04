process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const storage = require('../src/lib/storage');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, role: u.role, name: u.name, email: u.email });

// Temp files written into the real upload dirs; removed in afterAll.
const writtenFiles = [];
function writeUploadFile(dir, ext, bytes) {
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, bytes);
  writtenFiles.push(abs);
  return name;
}

let agencyA, agencyB, managerA, managerB, workerB, rtwFileName;

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Upload Sec A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `Upload Sec B ${suffix}` } });

  const mkUser = (agencyId, role, tag) =>
    prisma.user.create({
      data: {
        agencyId, role,
        name: `Upload ${tag}`,
        email: `upload-${tag}-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
      },
    });

  managerA = await mkUser(agencyA.id, 'MANAGER', 'mgrA');
  managerB = await mkUser(agencyB.id, 'MANAGER', 'mgrB');
  workerB = await mkUser(agencyB.id, 'WORKER', 'wkrB');

  // A real RTW proof document for workerB (agency B).
  rtwFileName = writeUploadFile(storage.RTW_DIR, '.pdf', '%PDF-1.4 fake proof');
  await prisma.shareCode.create({
    data: {
      agencyId: agencyB.id,
      userId: workerB.id,
      code: 'ABC123XYZ',
      shareDate: new Date(),
      documentPath: `/uploads/rtw/${rtwFileName}`,
      documentName: 'proof.pdf',
    },
  });
});

afterAll(async () => {
  await prisma.shareCode.deleteMany({ where: { userId: workerB.id } });
  await prisma.user.deleteMany({ where: { id: { in: [managerA.id, managerB.id, workerB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  for (const f of writtenFiles) { try { fs.unlinkSync(f); } catch { /* noop */ } }
  await prisma.$disconnect();
});

describe('static upload mount', () => {
  it('serves avatar images under /uploads/avatars', async () => {
    const name = writeUploadFile(storage.AVATARS_DIR, '.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const res = await request(app).get(`/uploads/avatars/${name}`);
    expect(res.status).toBe(200);
  });

  it('does NOT serve Right-to-Work documents statically (no /uploads/rtw route)', async () => {
    // The file genuinely exists on disk — a 404 proves the route is absent, not the file.
    const res = await request(app).get(`/uploads/rtw/${rtwFileName}`);
    expect(res.status).toBe(404);
  });

  it('does not expose the raw upload root', async () => {
    const res = await request(app).get(`/uploads/rtw`);
    expect(res.status).toBe(404);
  });
});

describe('resolveStoredPath — path traversal', () => {
  let warnSpy;
  beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => warnSpy.mockRestore());

  it('resolves legitimate stored paths inside UPLOAD_DIR', () => {
    const abs = storage.resolveStoredPath('/uploads/rtw/abc.pdf');
    expect(abs).toBe(path.join(storage.UPLOAD_DIR, 'rtw', 'abc.pdf'));
  });

  it('rejects paths that escape UPLOAD_DIR', () => {
    for (const bad of [
      '/uploads/../../etc/passwd',
      'uploads/../secret',
      '/uploads/rtw/../../../../etc/passwd',
      '/uploads/',
      '',
      null,
    ]) {
      expect(storage.resolveStoredPath(bad)).toBeNull();
    }
  });
});

describe('Right-to-Work document access control', () => {
  it('lets a manager in the same agency download the document', async () => {
    const res = await request(app)
      .get(`/right-to-work/user/${workerB.id}/document`)
      .set('Authorization', `Bearer ${tokenFor(managerB)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('proof.pdf');
  });

  it("blocks a manager in another agency from downloading the document", async () => {
    const res = await request(app)
      .get(`/right-to-work/user/${workerB.id}/document`)
      .set('Authorization', `Bearer ${tokenFor(managerA)}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/right-to-work/user/${workerB.id}/document`);
    expect(res.status).toBe(401);
  });
});
