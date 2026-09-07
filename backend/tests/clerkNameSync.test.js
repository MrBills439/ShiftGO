process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

// The webhook route verifies a Clerk/svix signature; stub it so tests can drive
// arbitrary verified events straight into the handler switch.
jest.mock('@clerk/express/webhooks', () => ({ verifyWebhook: jest.fn() }));
const { verifyWebhook } = require('@clerk/express/webhooks');

const app = require('../src/app');
const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let agency;
let user;

function postEvent(event) {
  verifyWebhook.mockResolvedValueOnce(event);
  return request(app).post('/webhooks/clerk').set('Content-Type', 'application/json').send('{}');
}

beforeAll(async () => {
  agency = await prisma.agency.create({ data: { name: `NameSync ${suffix}` } });
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { agencyId: agency.id } });
  user = await prisma.user.create({
    data: {
      agencyId: agency.id,
      clerkUserId: `user_ns_${suffix}`,
      // Legacy malformed state: name === email.
      name: `ns-${suffix}@shiftgo.test`,
      email: `ns-${suffix}@shiftgo.test`,
      passwordHash: 'x',
      role: 'WORKER',
      status: 'ACTIVE',
    },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { agencyId: agency.id } });
  await prisma.agency.delete({ where: { id: agency.id } });
  await prisma.$disconnect();
});

describe('Clerk user.updated -> local User name/email sync', () => {
  test('a real first/last name from Clerk replaces the email-as-name row', async () => {
    const res = await postEvent({
      type: 'user.updated',
      data: {
        id: user.clerkUserId,
        first_name: 'Felix',
        last_name: 'Kubi',
        email_addresses: [{ id: 'e1', email_address: `felix-${suffix}@newmail.test` }],
        primary_email_address_id: 'e1',
      },
    });
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated.name).toBe('Felix Kubi');
    expect(updated.email).toBe(`felix-${suffix}@newmail.test`);
  });

  test('role, agency and status are never touched by user.updated', async () => {
    await postEvent({
      type: 'user.updated',
      data: { id: user.clerkUserId, first_name: 'Sam', last_name: 'Lee', email_addresses: [] },
    });
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated.role).toBe('WORKER');
    expect(updated.agencyId).toBe(agency.id);
    expect(updated.status).toBe('ACTIVE');
    expect(updated.name).toBe('Sam Lee');
  });

  test('a blank Clerk name does not overwrite an existing good name', async () => {
    await prisma.user.update({ where: { id: user.id }, data: { name: 'Existing Realname' } });
    await postEvent({
      type: 'user.updated',
      data: {
        id: user.clerkUserId,
        first_name: null,
        last_name: null,
        email_addresses: [{ id: 'e1', email_address: `kept-${suffix}@mail.test` }],
        primary_email_address_id: 'e1',
      },
    });
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated.name).toBe('Existing Realname'); // unchanged
    expect(updated.email).toBe(`kept-${suffix}@mail.test`); // email still synced
  });

  test('user.updated for an unknown Clerk id is a harmless no-op', async () => {
    const before = await prisma.user.count({ where: { agencyId: agency.id } });
    const res = await postEvent({
      type: 'user.updated',
      data: { id: 'user_does_not_exist', first_name: 'Ghost', last_name: 'User', email_addresses: [] },
    });
    expect(res.status).toBe(200);
    const after = await prisma.user.count({ where: { agencyId: agency.id } });
    expect(after).toBe(before);
  });
});
