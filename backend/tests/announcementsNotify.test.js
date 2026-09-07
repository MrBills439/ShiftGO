process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const notificationService = require('../src/services/notificationService');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });

let agencyA;
let agencyB;
let hrA;
let workerA;
let managerA;
let workerB;

async function mkUser(agencyId, role, tag, extra = {}) {
  return prisma.user.create({
    data: { agencyId, role, name: `Ann ${tag}`, email: `ann-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x', ...extra },
  });
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Ann A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `Ann B ${suffix}` } });
  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  workerA = await mkUser(agencyA.id, 'WORKER', 'workerA', { fcmToken: 'fake-device-token' });
  managerA = await mkUser(agencyA.id, 'MANAGER', 'managerA');
  workerB = await mkUser(agencyB.id, 'WORKER', 'workerB');
});

afterEach(async () => {
  jest.restoreAllMocks();
  await prisma.notification.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.announcementRead.deleteMany({ where: { announcement: { agencyId: { in: [agencyA.id, agencyB.id] } } } });
  await prisma.announcement.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

function publish(user, body) {
  return request(app).post('/announcements').set('Authorization', `Bearer ${tokenFor(user)}`).send(body);
}

describe('announcement publish → notifications', () => {
  test('creates the Announcement row and it is returned by the list endpoint', async () => {
    const res = await publish(hrA, { title: 'Rota change', body: 'New rota is live.' });
    expect(res.status).toBe(201);

    const list = await request(app).get('/announcements').set('Authorization', `Bearer ${tokenFor(workerA)}`);
    expect(list.body.data.some((a) => a.id === res.body.data.id && a.title === 'Rota change')).toBe(true);
  });

  test('every active agency member except the author gets an in-app Notification row, and delivery (createAndSend) is invoked', async () => {
    // createAndSend is the shared "persist row + attempt push" primitive; spy on
    // it (calls through) so we can assert delivery was invoked per recipient.
    const sendSpy = jest.spyOn(notificationService, 'createAndSend');

    const res = await publish(hrA, { title: 'PPE reminder', body: 'Wear PPE at all times.' });
    const annId = res.body.data.id;

    const notifs = await prisma.notification.findMany({ where: { agencyId: agencyA.id, type: 'GENERAL' } });
    const byUser = Object.fromEntries(notifs.map((n) => [n.userId, n]));

    expect(byUser[workerA.id]).toBeTruthy();
    expect(byUser[managerA.id]).toBeTruthy();
    expect(byUser[hrA.id]).toBeUndefined(); // author excluded
    expect(byUser[workerA.id].data).toMatchObject({ kind: 'ANNOUNCEMENT', announcementId: annId });
    expect(byUser[workerA.id].title).toBe('PPE reminder');

    expect(sendSpy).toHaveBeenCalledWith(
      workerA.id, 'GENERAL', 'PPE reminder', 'Wear PPE at all times.',
      expect.objectContaining({ kind: 'ANNOUNCEMENT', announcementId: annId }),
    );
    // the recipient with a device token would have a push attempted inside createAndSend
    expect(sendSpy).toHaveBeenCalledWith(managerA.id, 'GENERAL', expect.any(String), expect.any(String), expect.any(Object));
  });

  test('another agency does not receive the announcement or its notifications', async () => {
    const res = await publish(hrA, { title: 'A-only', body: 'For agency A.' });

    expect(await prisma.notification.count({ where: { userId: workerB.id } })).toBe(0);

    const listB = await request(app).get('/announcements').set('Authorization', `Bearer ${tokenFor(workerB)}`);
    expect(listB.body.data.some((a) => a.id === res.body.data.id)).toBe(false);
  });

  test('re-running the fan-out for the same announcement does not create duplicate notifications', async () => {
    const res = await publish(hrA, { title: 'Once only', body: 'Idempotent.' });
    const ann = await prisma.announcement.findUnique({ where: { id: res.body.data.id } });

    const { notifyAgencyOfAnnouncement } = require('../src/services/announcementService');
    await notifyAgencyOfAnnouncement(ann, agencyA.id);
    await notifyAgencyOfAnnouncement(ann, agencyA.id);

    expect(await prisma.notification.count({ where: { userId: workerA.id, type: 'GENERAL' } })).toBe(1);
  });

  test('the announcement remains listed after notification delivery (not deleted/archived on send)', async () => {
    const res = await publish(hrA, { title: 'Stays visible', body: 'Should not vanish.' });

    // notifications were sent as part of publish; the row must still be there.
    const list = await request(app).get('/announcements').set('Authorization', `Bearer ${tokenFor(hrA)}`);
    expect(list.body.data.some((a) => a.id === res.body.data.id)).toBe(true);
    expect(await prisma.announcement.findUnique({ where: { id: res.body.data.id } })).toBeTruthy();
  });
});
