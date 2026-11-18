// Week 3: data retention — GPS coordinates and expired right-to-work records.
process.env.NODE_ENV = 'test';
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');
const storage = require('../src/lib/storage');
const { runRetentionJob } = require('../src/jobs/retentionJob');

const DAY = 86_400_000;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ago = (days) => new Date(Date.now() - days * DAY);

let agency; let worker; let leaverOld; let leaverRecent; let house; let shift;

async function clockEvent(capturedAt) {
  return prisma.clockEvent.create({
    data: {
      agencyId: agency.id, workerId: worker.id, houseId: house.id, shiftId: shift.id, type: 'IN', method: 'MANUAL',
      timestamp: capturedAt, capturedAt, latitude: 51.501, longitude: -0.141, accuracy: 8,
      distanceMeters: 12, withinGeofence: true, locationStatusResult: 'ONSITE', gpsConfidence: 'HIGH',
    },
  });
}

beforeAll(async () => {
  ensure();
  agency = await prisma.agency.create({ data: { name: `Retention ${suffix}` } });
  const mk = (tag, extra = {}) => prisma.user.create({ data: { agencyId: agency.id, role: 'WORKER', name: tag, email: `ret-${tag}-${suffix}@shiftgo.test`, ...extra } });
  worker = await mk('worker');
  leaverOld = await mk('leaver-old', { status: 'DEACTIVATED', deactivatedAt: ago(800) });
  leaverRecent = await mk('leaver-recent', { status: 'DEACTIVATED', deactivatedAt: ago(100) });
  house = await prisma.house.create({ data: { agencyId: agency.id, name: 'Ret House', address: 'x', latitude: 51.5, longitude: -0.14 } });
  shift = await prisma.shift.create({ data: { agencyId: agency.id, houseId: house.id, workerId: worker.id, createdById: worker.id, startTime: ago(1), endTime: ago(1), date: ago(1) } });
});

function ensure() { storage.ensureUploadDirs(); }

afterEach(() => { delete process.env.RETENTION_ENABLED; });

afterAll(async () => {
  await prisma.clockEvent.deleteMany({ where: { agencyId: agency.id } });
  await prisma.shift.deleteMany({ where: { agencyId: agency.id } });
  await prisma.house.deleteMany({ where: { agencyId: agency.id } });
  await prisma.shareCode.deleteMany({ where: { agencyId: agency.id } });
  await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
  await prisma.user.deleteMany({ where: { agencyId: agency.id } });
  await prisma.agency.delete({ where: { id: agency.id } });
});

test('report-only by default: counts what it would remove, changes nothing', async () => {
  const old = await clockEvent(ago(120));
  const summary = await runRetentionJob();
  expect(summary.mode).toBe('report-only');
  expect(summary.gps.clockEvents).toBeGreaterThanOrEqual(1);
  expect((await prisma.clockEvent.findUnique({ where: { id: old.id } })).latitude).toBe(51.501);
});

test('GPS: coordinates older than the period are cleared, the attendance outcome is kept', async () => {
  const old = await clockEvent(ago(120));
  const recent = await clockEvent(ago(10));
  process.env.RETENTION_ENABLED = 'true';
  await runRetentionJob();

  const o = await prisma.clockEvent.findUnique({ where: { id: old.id } });
  expect(o.latitude).toBeNull();
  expect(o.longitude).toBeNull();
  expect(o).toMatchObject({ withinGeofence: true, distanceMeters: 12, locationStatusResult: 'ONSITE', accuracy: 8 });

  const r = await prisma.clockEvent.findUnique({ where: { id: recent.id } });
  expect(r.latitude).toBe(51.501);
});

test('GPS_RETENTION_DAYS is respected', async () => {
  const e = await clockEvent(ago(40));
  process.env.RETENTION_ENABLED = 'true';
  process.env.GPS_RETENTION_DAYS = '30';
  await runRetentionJob();
  delete process.env.GPS_RETENTION_DAYS;
  expect((await prisma.clockEvent.findUnique({ where: { id: e.id } })).latitude).toBeNull();
});

test('RTW: removed 2 years after leaving (document too); kept for recent leavers and current staff', async () => {
  const docName = `${'d'.repeat(32)}.pdf`;
  const docAbs = path.join(storage.RTW_DIR, docName);
  fs.writeFileSync(docAbs, '%PDF-1.4 retention');
  const oldRec = await prisma.shareCode.create({ data: { agencyId: agency.id, userId: leaverOld.id, code: 'OLD000001', shareDate: ago(900), documentPath: `/uploads/rtw/${docName}` } });
  await prisma.shareCode.create({ data: { agencyId: agency.id, userId: leaverRecent.id, code: 'NEW000001', shareDate: ago(200) } });
  await prisma.shareCode.create({ data: { agencyId: agency.id, userId: worker.id, code: 'CUR000001', shareDate: ago(30) } });

  // report-only first: nothing removed
  expect((await runRetentionJob()).rtw.records).toBe(1);
  expect(fs.existsSync(docAbs)).toBe(true);

  process.env.RETENTION_ENABLED = 'true';
  const summary = await runRetentionJob();
  expect(summary.rtw.records).toBe(1);
  expect(await prisma.shareCode.findUnique({ where: { id: oldRec.id } })).toBeNull();
  expect(fs.existsSync(docAbs)).toBe(false);
  expect(await prisma.shareCode.findUnique({ where: { userId: leaverRecent.id } })).toBeTruthy();
  expect(await prisma.shareCode.findUnique({ where: { userId: worker.id } })).toBeTruthy();

  const log = await prisma.auditLog.findFirst({ where: { agencyId: agency.id, action: 'RTW_RECORD_DELETED_RETENTION' } });
  expect(log.oldValue.subjectUserId).toBe(leaverOld.id);
  expect(JSON.stringify(log)).not.toContain('OLD000001');
});
