// Week 3: privacy notice acknowledgement, subject access export, account
// deletion requests.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const prisma = require('../src/lib/prisma');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const auth = (u) => ({ Authorization: `Bearer ${signAccess({ id: u.id, agencyId: u.agencyId, role: u.role })}` });
let agency; let otherAgency; let hr; let manager; let worker; let colleague; let outsider; let house;

const mk = (agencyId, role, tag, extra = {}) => prisma.user.create({
  data: { agencyId, role, name: `DR ${tag}`, email: `dr-${tag}-${suffix}@shiftgo.test`, ...extra },
});

beforeAll(async () => {
  agency = await prisma.agency.create({ data: { name: `Sunrise Care ${suffix}` } });
  otherAgency = await prisma.agency.create({ data: { name: `Other ${suffix}` } });
  hr = await mk(agency.id, 'HR', 'hr');
  manager = await mk(agency.id, 'MANAGER', 'mgr');
  worker = await mk(agency.id, 'WORKER', 'worker', {
    phone: '07700 900111', address: '1 Private Road', passwordHash: 'should-never-leak', fcmToken: 'fcm-secret-token',
    emergencyContactName: 'Mum', emergencyContactPhone: '07700 900222',
  });
  colleague = await mk(agency.id, 'WORKER', 'colleague', { phone: '07700 900333' });
  outsider = await mk(otherAgency.id, 'HR', 'outsider');
  house = await prisma.house.create({ data: { agencyId: agency.id, name: 'Oak House', address: 'x', latitude: 51.5, longitude: -0.1 } });
  const now = new Date();
  for (const w of [worker, colleague]) {
    const shift = await prisma.shift.create({ data: { agencyId: agency.id, houseId: house.id, workerId: w.id, createdById: manager.id, startTime: now, endTime: now, date: now } });
    await prisma.timesheet.create({ data: { agencyId: agency.id, houseId: house.id, workerId: w.id, shiftId: shift.id, totalHours: 8, reviewedById: manager.id, status: 'APPROVED' } });
    await prisma.clockEvent.create({ data: { agencyId: agency.id, workerId: w.id, houseId: house.id, shiftId: shift.id, type: 'IN', method: 'MANUAL', latitude: 51.5001, longitude: -0.1001, withinGeofence: true } });
  }
  await prisma.dbsCheck.create({ data: { agencyId: agency.id, userId: worker.id, status: 'CLEAR', notes: 'clear' } });
  await prisma.notification.create({ data: { agencyId: agency.id, userId: worker.id, type: 'GENERAL', title: 't', body: 'b' } });
});

describe('Privacy notice', () => {
  test('staff see the default template with their agency name, not yet acknowledged', async () => {
    const res = await request(app).get('/privacy-notice').set(auth(worker));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isDefault: true, acknowledged: false });
    expect(res.body.data.text).toContain(agency.name);
    expect(res.body.data.text).toContain('only');
  });

  test('acknowledging needs the current version; then it is recorded', async () => {
    const { version } = (await request(app).get('/privacy-notice').set(auth(worker))).body.data;
    expect((await request(app).post('/privacy-notice/acknowledge').set(auth(worker)).send({ version: 'old' })).status).toBe(409);
    const ok = await request(app).post('/privacy-notice/acknowledge').set(auth(worker)).send({ version });
    expect(ok.status).toBe(200);
    expect(ok.body.data.acknowledged).toBe(true);
    expect((await request(app).get('/privacy-notice').set(auth(worker))).body.data.acknowledged).toBe(true);
  });

  test('HR publishing a new notice asks everyone to acknowledge again; only HR can', async () => {
    expect((await request(app).put('/privacy-notice').set(auth(manager)).send({ text: 'x' })).status).toBe(403);
    const put = await request(app).put('/privacy-notice').set(auth(hr)).send({ text: '# Our own notice' });
    expect(put.status).toBe(200);
    expect(put.body.data.isDefault).toBe(false);
    const after = (await request(app).get('/privacy-notice').set(auth(worker))).body.data;
    expect(after).toMatchObject({ text: '# Our own notice', acknowledged: false });
    // empty text returns to the template
    const reset = await request(app).put('/privacy-notice').set(auth(hr)).send({ text: '' });
    expect(reset.body.data.isDefault).toBe(true);
  });
});

describe('Subject access export', () => {
  test('a worker downloads their own data, without secrets or colleagues\' data', async () => {
    const res = await request(app).get('/users/me/export').set(auth(worker));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="shiftgo-my-data-/);
    const data = JSON.parse(res.text);
    expect(data.profile).toMatchObject({ email: worker.email, phone: '07700 900111' });
    expect(data.shifts).toHaveLength(1);
    expect(data.timesheets[0]).toMatchObject({ totalHours: 8, reviewedByRole: 'MANAGER' });
    expect(data.clockEvents[0].latitude).toBe(51.5001);
    expect(data.dbsCheck.status).toBe('CLEAR');
    expect(data.services).toEqual([]);
    for (const s of ['should-never-leak', 'fcm-secret-token', colleague.email, '07700 900333', manager.name]) {
      expect(res.text).not.toContain(s);
    }
    const log = await prisma.auditLog.findFirst({ where: { agencyId: agency.id, action: 'PERSONAL_DATA_EXPORTED', actorId: worker.id } });
    expect(log.newValue).toMatchObject({ subjectUserId: worker.id, bySelf: true });
  });

  test('HR can export for an employee; managers and other agencies cannot', async () => {
    expect((await request(app).get(`/users/${worker.id}/export`).set(auth(hr))).status).toBe(200);
    expect((await request(app).get(`/users/${worker.id}/export`).set(auth(manager))).status).toBe(403);
    expect((await request(app).get(`/users/${worker.id}/export`).set(auth(outsider))).status).toBe(404);
  });
});

describe('Account deletion requests', () => {
  let requestId;

  test('a worker asks; HR is notified; a second ask is refused; they can cancel', async () => {
    const first = await request(app).post('/users/me/deletion-request').set(auth(colleague)).send({ reason: 'leaving' });
    expect(first.status).toBe(201);
    expect((await request(app).post('/users/me/deletion-request').set(auth(colleague)).send({})).status).toBe(409);
    const note = await prisma.notification.findFirst({ where: { userId: hr.id, title: 'Account deletion request' } });
    expect(note).toBeTruthy();
    const cancelled = await request(app).post('/users/me/deletion-request/cancel').set(auth(colleague));
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  test('only HR sees and decides requests; rejecting needs a reason', async () => {
    requestId = (await request(app).post('/users/me/deletion-request').set(auth(worker)).send({})).body.data.id;
    expect((await request(app).get('/deletion-requests').set(auth(manager))).status).toBe(403);
    const list = await request(app).get('/deletion-requests').set(auth(hr));
    expect(list.body.data.map((r) => r.id)).toContain(requestId);
    expect((await request(app).post(`/deletion-requests/${requestId}/reject`).set(auth(hr)).send({})).status).toBe(400);
  });

  test('completing requires deactivation first', async () => {
    const res = await request(app).post(`/deletion-requests/${requestId}/complete`).set(auth(hr)).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_DEACTIVATED');
  });

  test('completing erases what can go and keeps what the law requires', async () => {
    await prisma.user.update({ where: { id: worker.id }, data: { status: 'DEACTIVATED', deactivatedAt: new Date() } });
    const res = await request(app).post(`/deletion-requests/${requestId}/complete`).set(auth(hr)).send({ note: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');

    const u = await prisma.user.findUnique({ where: { id: worker.id } });
    expect(u).toMatchObject({ phone: null, address: null, fcmToken: null, emergencyContactName: null, emergencyContactPhone: null });
    expect(u.name).toBe(worker.name); // kept: identifies retained records
    expect(await prisma.notification.count({ where: { userId: worker.id } })).toBe(0);
    expect(await prisma.dbsCheck.count({ where: { userId: worker.id } })).toBe(0);
    const ev = await prisma.clockEvent.findFirst({ where: { workerId: worker.id } });
    expect(ev.latitude).toBeNull();
    expect(ev.withinGeofence).toBe(true);
    expect(await prisma.timesheet.count({ where: { workerId: worker.id } })).toBe(1); // kept: payroll
    // a colleague is untouched
    expect((await prisma.user.findUnique({ where: { id: colleague.id } })).phone).toBe('07700 900333');
    expect((await request(app).post(`/deletion-requests/${requestId}/complete`).set(auth(hr)).send({})).status).toBe(409);
  });
});

afterAll(async () => {
  const ids = [agency.id, otherAgency.id];
  await prisma.accountDeletionRequest.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.timesheet.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.clockEvent.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.shift.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.house.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.dbsCheck.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: ids } } });
  await prisma.agency.deleteMany({ where: { id: { in: ids } } });
});
