process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'false';
process.env.AUTH_RATE_LIMIT_MAX = '2';
process.env.API_RATE_LIMIT_MAX = '20';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { signAccess } = require('../src/utils/jwt');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let agency;
let manager;

function loadApp() {
  jest.resetModules();
  return require('../src/app');
}

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

describe('Rate limiting', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Rate Limit Agency ${suffix}` } });
    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Rate Limit Manager',
        email: `rate-limit-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { agencyId: agency?.id } });
    if (agency) await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  it('keeps health checks outside the API limiter', async () => {
    const app = loadApp();

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });

  it('does not block ordinary authenticated routes too aggressively', async () => {
    const app = loadApp();
    const token = tokenFor(manager);

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .get('/users')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).not.toBe(429);
    }
  });
});
