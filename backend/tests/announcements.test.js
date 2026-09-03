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

let agency;
let otherAgency;
let hr;
let manager;
let worker;
let otherAgencyHr;

function tokenFor(user) {
  return signAccess({
    id: user.id,
    agencyId: user.agencyId,
    role: user.role,
    status: user.status,
    name: user.name,
    email: user.email,
  });
}

describe('Announcements', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Announcement Agency ${suffix}` } });
    otherAgency = await prisma.agency.create({ data: { name: `Other Announcement Agency ${suffix}` } });

    hr = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Announcement HR',
        email: `announcement-hr-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'HR',
      },
    });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Announcement Manager',
        email: `announcement-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Announcement Worker',
        email: `announcement-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    otherAgencyHr = await prisma.user.create({
      data: {
        agencyId: otherAgency.id,
        name: 'Other Agency HR',
        email: `other-announcement-hr-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'HR',
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agency.id, otherAgency.id] } } });
    await prisma.announcement.deleteMany({ where: { agencyId: { in: [agency.id, otherAgency.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [hr.id, manager.id, worker.id, otherAgencyHr.id] } } });
    await prisma.agency.deleteMany({ where: { id: { in: [agency.id, otherAgency.id] } } });
    await prisma.$disconnect();
  });

  it('rejects a worker attempting to create an announcement', async () => {
    const res = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ title: 'Not allowed', body: 'Workers cannot post announcements' });

    expect(res.status).toBe(403);
  });

  it('rejects a missing title or body', async () => {
    const res = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ title: '', body: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      title: expect.any(String),
      body: expect.any(String),
    }));
  });

  it('lets a manager create an announcement and a worker read it', async () => {
    const create = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ title: 'Rota changes', body: 'Bank holiday rota is now live.' });

    expect(create.status).toBe(201);
    expect(create.body.data).toEqual(expect.objectContaining({
      title: 'Rota changes',
      body: 'Bank holiday rota is now live.',
      pinned: false,
      author: expect.objectContaining({ id: manager.id, name: manager.name }),
    }));

    const list = await request(app)
      .get('/announcements')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);

    expect(list.status).toBe(200);
    expect(list.body.data.some((a) => a.id === create.body.data.id)).toBe(true);
  });

  it('orders pinned announcements first, then newest first', async () => {
    await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({ title: 'Older update', body: 'This came first.' });

    const pinned = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({ title: 'Pinned notice', body: 'This is pinned.', pinned: true });

    const list = await request(app)
      .get('/announcements')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);

    expect(list.status).toBe(200);
    expect(list.body.data[0].id).toBe(pinned.body.data.id);
    expect(list.body.data[0].pinned).toBe(true);
  });

  it('does not leak announcements across agencies', async () => {
    await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(otherAgencyHr)}`)
      .send({ title: 'Other agency only', body: 'Should not be visible to the first agency.' });

    const list = await request(app)
      .get('/announcements')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);

    expect(list.status).toBe(200);
    expect(list.body.data.some((a) => a.title === 'Other agency only')).toBe(false);
  });

  it('rejects a worker attempting to delete an announcement, and allows HR to delete it', async () => {
    const create = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ title: 'To be deleted', body: 'Temporary announcement.' });

    const deniedDelete = await request(app)
      .delete(`/announcements/${create.body.data.id}`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(deniedDelete.status).toBe(403);

    const del = await request(app)
      .delete(`/announcements/${create.body.data.id}`)
      .set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(del.status).toBe(200);

    const list = await request(app)
      .get('/announcements')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(list.body.data.some((a) => a.id === create.body.data.id)).toBe(false);
  });

  it('returns 404 when deleting an announcement from another agency', async () => {
    const create = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(otherAgencyHr)}`)
      .send({ title: 'Cross-agency delete attempt', body: 'Should not be deletable by the first agency.' });

    const del = await request(app)
      .delete(`/announcements/${create.body.data.id}`)
      .set('Authorization', `Bearer ${tokenFor(hr)}`);

    expect(del.status).toBe(404);
  });

  it('lists a newly created announcement as unread, and marks it read for that worker only', async () => {
    const create = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ title: 'Read tracking test', body: 'Should appear unread until acknowledged.' });
    const announcementId = create.body.data.id;

    const unreadBefore = await request(app)
      .get('/announcements/unread')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(unreadBefore.status).toBe(200);
    expect(unreadBefore.body.data.some((a) => a.id === announcementId)).toBe(true);

    const listBefore = await request(app)
      .get('/announcements')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(listBefore.body.data.find((a) => a.id === announcementId).read).toBe(false);

    const markRead = await request(app)
      .post(`/announcements/${announcementId}/read`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(markRead.status).toBe(200);

    const unreadAfter = await request(app)
      .get('/announcements/unread')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(unreadAfter.body.data.some((a) => a.id === announcementId)).toBe(false);

    const listAfter = await request(app)
      .get('/announcements')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(listAfter.body.data.find((a) => a.id === announcementId).read).toBe(true);

    // Marking read for one worker must not affect another worker's unread state.
    const otherUnread = await request(app)
      .get('/announcements/unread')
      .set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(otherUnread.body.data.some((a) => a.id === announcementId)).toBe(true);
  });

  it('is idempotent when marking the same announcement read twice', async () => {
    const create = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ title: 'Idempotent read test', body: 'Marking read twice should not error.' });

    const first = await request(app)
      .post(`/announcements/${create.body.data.id}/read`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/announcements/${create.body.data.id}/read`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`);
    expect(second.status).toBe(200);
  });

  it('returns 404 when marking an announcement from another agency as read', async () => {
    const create = await request(app)
      .post('/announcements')
      .set('Authorization', `Bearer ${tokenFor(otherAgencyHr)}`)
      .send({ title: 'Cross-agency read attempt', body: 'Should not be markable by the first agency.' });

    const markRead = await request(app)
      .post(`/announcements/${create.body.data.id}/read`)
      .set('Authorization', `Bearer ${tokenFor(worker)}`);

    expect(markRead.status).toBe(404);
  });
});
