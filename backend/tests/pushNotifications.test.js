process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function tokenFor(user) {
  const { signAccess } = require('../src/utils/jwt');
  return signAccess({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  });
}

function testUser(role, suffix) {
  return prisma.user.create({
    data: {
      name: `Push ${role}`,
      email: `push-${role.toLowerCase()}-${suffix}@shiftgo.test`,
      passwordHash: 'test-password-hash',
      role,
    },
  });
}

describe('Push notification readiness', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let manager;
  let worker;

  beforeAll(async () => {
    manager = await testUser('MANAGER', suffix);
    worker = await testUser('WORKER', suffix);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [manager?.id, worker?.id].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../src/services/notificationService');
  });

  it('reports unhealthy when Firebase is required but missing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.FIREBASE_REQUIRED = 'true';
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;

    const app = require('../src/app');
    const res = await request(app)
      .get('/notifications/push/status')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(503);
    expect(res.body.data).toEqual(expect.objectContaining({
      required: true,
      configured: false,
      ready: false,
    }));
    expect(res.body.data.missing).toEqual(expect.arrayContaining([
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
    ]));
  });

  it('registers a device token for the current user', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FIREBASE_REQUIRED = 'false';
    const app = require('../src/app');

    const res = await request(app)
      .patch('/users/me/fcm-token')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ fcmToken: 'test-native-device-token-1234567890' });

    expect(res.status).toBe(200);
    const stored = await prisma.user.findUnique({ where: { id: worker.id }, select: { fcmToken: true } });
    expect(stored.fcmToken).toBe('test-native-device-token-1234567890');
  });

  it('sends a test push through the notification service', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FIREBASE_REQUIRED = 'false';
    const sendPush = jest.fn().mockResolvedValue({ sent: true, messageId: 'mock-message-id' });
    jest.doMock('../src/services/notificationService', () => ({
      getMessaging: jest.fn(),
      firebaseStatus: jest.fn(() => ({ required: false, configured: true, ready: true, missing: [], error: null })),
      sendPush,
    }));
    const app = require('../src/app');

    const res = await request(app)
      .post('/notifications/push/test')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({
        token: 'test-native-device-token-1234567890',
        title: 'Test title',
        body: 'Test body',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ sent: true, messageId: 'mock-message-id' });
    expect(sendPush).toHaveBeenCalledWith('test-native-device-token-1234567890', {
      title: 'Test title',
      body: 'Test body',
    });
  });
});
