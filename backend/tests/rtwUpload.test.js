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
const appPrisma = require('../src/lib/prisma');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });

const VALID_PDF = Buffer.from('%PDF-1.4\n1 0 obj<< >>endobj\ntrailer<< >>\n%%EOF\n', 'latin1');
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]); // "MZ..." PE header
const PLAIN_BYTES = Buffer.from('this is definitely not a pdf', 'utf8');
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const listOr = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const acceptedFiles = () => new Set(listOr(storage.RTW_DIR).filter((n) => n !== '_quarantine'));
const quarantineFiles = () => new Set(listOr(storage.RTW_QUARANTINE_DIR));
const diff = (after, before) => [...after].filter((n) => !before.has(n));

const uploadDoc = (u, bytes, { filename = 'proof.pdf', contentType = 'application/pdf' } = {}) =>
  request(app).post('/right-to-work/me/document')
    .set('Authorization', `Bearer ${tokenFor(u)}`)
    .attach('document', bytes, { filename, contentType });

let agency;
let worker;
const strayFiles = [];

beforeAll(async () => {
  agency = await prisma.agency.create({ data: { name: `RTWq ${suffix}` } });
  worker = await prisma.user.create({ data: { agencyId: agency.id, role: 'WORKER', name: 'RTWq W', email: `rtwq-${suffix}@shiftgo.test`, passwordHash: 'x' } });
});

afterAll(async () => {
  for (const f of strayFiles) { try { fs.unlinkSync(f); } catch { /* noop */ } }
  await prisma.shareCode.deleteMany({ where: { agencyId: agency.id } });
  await prisma.user.deleteMany({ where: { agencyId: agency.id } });
  await prisma.agency.deleteMany({ where: { id: agency.id } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.shareCode.upsert({
    where: { userId: worker.id },
    create: { agencyId: agency.id, userId: worker.id, code: 'ABC123XYZ', shareDate: new Date(), documentPath: null, documentName: null },
    update: { documentPath: null, documentName: null },
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  const rec = await prisma.shareCode.findUnique({ where: { userId: worker.id } });
  if (rec?.documentPath) {
    const abs = storage.resolveStoredPath(rec.documentPath);
    if (abs) { try { fs.unlinkSync(abs); } catch { /* noop */ } }
  }
  await prisma.shareCode.deleteMany({ where: { userId: worker.id } });
});

describe('RTW upload — quarantine → validate → promote → persist', () => {
  test('a valid PDF is written to _quarantine, promoted into RTW_DIR, then recorded', async () => {
    const renameSpy = jest.spyOn(fs.promises, 'rename'); // calls through
    const acceptedBefore = acceptedFiles();

    const res = await uploadDoc(worker, VALID_PDF);
    expect(res.status).toBe(200);

    // rename was source=_quarantine/<x>.pdf  ->  dest=rtw/<x>.pdf (not in _quarantine)
    expect(renameSpy).toHaveBeenCalledTimes(1);
    const [src, dest] = renameSpy.mock.calls[0];
    expect(storage.isInsideDir(storage.RTW_QUARANTINE_DIR, src)).toBe(true);
    expect(storage.isInsideDir(storage.RTW_DIR, dest)).toBe(true);
    expect(storage.isInsideDir(storage.RTW_QUARANTINE_DIR, dest)).toBe(false);
    expect(path.basename(src)).toBe(path.basename(dest));

    // End state: file in the accepted dir, nothing left in quarantine, DB points at it.
    const added = diff(acceptedFiles(), acceptedBefore);
    expect(added).toHaveLength(1);
    expect(quarantineFiles().size).toBe(0);
    expect(res.body.data.documentUrl).toBe(`/uploads/rtw/${added[0]}`);
    const abs = storage.resolveStoredPath(res.body.data.documentUrl);
    expect(fs.existsSync(abs)).toBe(true);
    strayFiles.push(abs);
  });

  test('successful upload leaves no quarantine file', async () => {
    const up = await uploadDoc(worker, VALID_PDF);
    expect(up.status).toBe(200);
    expect(quarantineFiles().size).toBe(0);
    strayFiles.push(storage.resolveStoredPath(up.body.data.documentUrl));
  });

  test('invalid PDF signature: 415, no quarantine file, no accepted file, no DB record', async () => {
    const acceptedBefore = acceptedFiles();
    const res = await uploadDoc(worker, EXE_BYTES, { filename: 'passport.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
    expect(res.body.message).toMatch(/not a valid pdf/i);
    expect(quarantineFiles().size).toBe(0);
    expect(diff(acceptedFiles(), acceptedBefore)).toEqual([]);
    expect((await prisma.shareCode.findUnique({ where: { userId: worker.id } })).documentPath).toBeNull();
  });

  test('fake application/pdf with non-PDF bytes: 415, quarantine + DB clean', async () => {
    const res = await uploadDoc(worker, PLAIN_BYTES, { filename: 'proof.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(415);
    expect(quarantineFiles().size).toBe(0);
    expect((await prisma.shareCode.findUnique({ where: { userId: worker.id } })).documentPath).toBeNull();
  });

  test('MIME rejection (real PNG): 4xx, no quarantine file, no DB record', async () => {
    const acceptedBefore = acceptedFiles();
    const res = await uploadDoc(worker, PNG_BYTES, { filename: 'proof.png', contentType: 'image/png' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(quarantineFiles().size).toBe(0);
    expect(diff(acceptedFiles(), acceptedBefore)).toEqual([]);
    expect((await prisma.shareCode.findUnique({ where: { userId: worker.id } })).documentPath).toBeNull();
  });

  test('MIME mismatch (PDF bytes declared image/png): 4xx, quarantine + DB clean', async () => {
    const res = await uploadDoc(worker, VALID_PDF, { filename: 'proof.pdf', contentType: 'image/png' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(quarantineFiles().size).toBe(0);
    expect((await prisma.shareCode.findUnique({ where: { userId: worker.id } })).documentPath).toBeNull();
  });

  test('oversized upload (> 10 MB): 413, no quarantine file, no DB record', async () => {
    const acceptedBefore = acceptedFiles();
    const big = Buffer.concat([VALID_PDF, Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20)]);
    const res = await uploadDoc(worker, big);
    expect(res.status).toBe(413);
    expect(quarantineFiles().size).toBe(0);
    expect(diff(acceptedFiles(), acceptedBefore)).toEqual([]);
    expect((await prisma.shareCode.findUnique({ where: { userId: worker.id } })).documentPath).toBeNull();
  });

  test('failed promotion (rename throws): 5xx, quarantine cleaned, no accepted file, no DB record', async () => {
    jest.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'));
    const acceptedBefore = acceptedFiles();

    const res = await uploadDoc(worker, VALID_PDF);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(quarantineFiles().size).toBe(0);
    expect(diff(acceptedFiles(), acceptedBefore)).toEqual([]);
    expect((await prisma.shareCode.findUnique({ where: { userId: worker.id } })).documentPath).toBeNull();
  });

  test('DB write fails AFTER promotion: promoted orphan is deleted, no DB record', async () => {
    jest.spyOn(appPrisma.shareCode, 'update').mockRejectedValueOnce(new Error('simulated DB failure'));
    const acceptedBefore = acceptedFiles();

    const res = await uploadDoc(worker, VALID_PDF);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(diff(acceptedFiles(), acceptedBefore)).toEqual([]); // promoted file removed
    expect(quarantineFiles().size).toBe(0);
    expect((await prisma.shareCode.findUnique({ where: { userId: worker.id } })).documentPath).toBeNull();
  });

  test('a previous valid RTW document survives a failed replacement', async () => {
    // Seed an existing, accepted document for the worker.
    const prevName = `prev-${suffix}.pdf`;
    const prevAbs = path.join(storage.RTW_DIR, prevName);
    fs.writeFileSync(prevAbs, VALID_PDF);
    strayFiles.push(prevAbs);
    await prisma.shareCode.update({
      where: { userId: worker.id },
      data: { documentPath: `/uploads/rtw/${prevName}`, documentName: 'prev.pdf' },
    });

    jest.spyOn(appPrisma.shareCode, 'update').mockRejectedValueOnce(new Error('simulated DB failure on replace'));
    const acceptedBefore = acceptedFiles();

    const res = await uploadDoc(worker, VALID_PDF);
    expect(res.status).toBeGreaterThanOrEqual(500);

    // Previous document untouched: still on disk, DB row unchanged.
    expect(fs.existsSync(prevAbs)).toBe(true);
    const rec = await prisma.shareCode.findUnique({ where: { userId: worker.id } });
    expect(rec.documentPath).toBe(`/uploads/rtw/${prevName}`);
    expect(rec.documentName).toBe('prev.pdf');
    // The new upload left nothing behind.
    expect(diff(acceptedFiles(), acceptedBefore)).toEqual([]);
    expect(quarantineFiles().size).toBe(0);
  });

  test('promoteRtwUpload refuses any source outside the quarantine dir', async () => {
    await expect(storage.promoteRtwUpload('/etc/passwd')).rejects.toThrow(/quarantine/i);
    await expect(
      storage.promoteRtwUpload(path.join(storage.RTW_QUARANTINE_DIR, '..', 'evil.pdf')),
    ).rejects.toThrow(/quarantine/i);
    await expect(
      storage.promoteRtwUpload(path.join(storage.RTW_DIR, 'already-accepted.pdf')),
    ).rejects.toThrow(/quarantine/i);
  });

  test('a traversal-style original filename cannot escape RTW storage; label is sanitised', async () => {
    const res = await uploadDoc(worker, VALID_PDF, { filename: '../../../../etc/passwd.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.data.documentUrl).toMatch(/^\/uploads\/rtw\/[0-9a-f]+\.pdf$/);
    expect(res.body.data.documentName).not.toMatch(/[/\\]/);
    const abs = storage.resolveStoredPath(res.body.data.documentUrl);
    expect(storage.isInsideDir(storage.RTW_DIR, abs)).toBe(true);
    expect(storage.isInsideDir(storage.RTW_QUARANTINE_DIR, abs)).toBe(false);
    strayFiles.push(abs);
  });

  test('accepted RTW documents are not statically served', async () => {
    const up = await uploadDoc(worker, VALID_PDF);
    strayFiles.push(storage.resolveStoredPath(up.body.data.documentUrl));
    expect((await request(app).get(up.body.data.documentUrl)).status).toBe(404);
    expect((await request(app).get('/uploads/rtw')).status).toBe(404);
  });

  test('the _quarantine directory is never statically served', async () => {
    // Plant a file directly in _quarantine and confirm it is unreachable.
    const name = `probe-${suffix}.pdf`;
    fs.mkdirSync(storage.RTW_QUARANTINE_DIR, { recursive: true });
    const abs = path.join(storage.RTW_QUARANTINE_DIR, name);
    fs.writeFileSync(abs, VALID_PDF);
    strayFiles.push(abs);
    expect((await request(app).get(`/uploads/rtw/_quarantine/${name}`)).status).toBe(404);
    expect((await request(app).get('/uploads/rtw/_quarantine')).status).toBe(404);
    fs.unlinkSync(abs);
  });

  test('the authenticated download of an existing RTW document still works', async () => {
    const up = await uploadDoc(worker, VALID_PDF);
    strayFiles.push(storage.resolveStoredPath(up.body.data.documentUrl));
    const res = await request(app)
      .get('/right-to-work/me/document')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBeDefined();
  });
});
