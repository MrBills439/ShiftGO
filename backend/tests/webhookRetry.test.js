// Audit fix 5: a webhook whose handler fails must answer non-2xx so Clerk
// retries it, and a retry after the failure must succeed (handlers idempotent).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

let mockClerkUser = null;
let mockGetUserFailuresLeft = 0;
jest.mock('../src/utils/clerkClient', () => ({
  organizations: { getOrganization: jest.fn(), updateOrganizationMembership: jest.fn(async () => ({})) },
  users: {
    getUser: jest.fn(async () => {
      if (mockGetUserFailuresLeft > 0) {
        mockGetUserFailuresLeft -= 1;
        throw new Error('Clerk API timeout');
      }
      return mockClerkUser;
    }),
  },
}));
jest.mock('@clerk/express/webhooks', () => ({ verifyWebhook: jest.fn() }));
const { verifyWebhook } = require('@clerk/express/webhooks');
const app = require('../src/app');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const postEvent = (event) => {
  verifyWebhook.mockResolvedValueOnce(event);
  return request(app).post('/webhooks/clerk').set('Content-Type', 'application/json').send('{}');
};

afterAll(() => prisma.$disconnect());

test('a failed membership event returns 500, and the retry creates the user', async () => {
  const agency = await prisma.agency.create({ data: { name: `Webhook ${suffix}`, clerkOrgId: `org_wh_${suffix}` } });
  const clerkUserId = `user_wh_${suffix}`;
  const email = `wh-${suffix}@shiftgo.test`;
  mockClerkUser = {
    id: clerkUserId,
    firstName: 'Retry',
    lastName: 'Person',
    primaryEmailAddressId: 'e1',
    emailAddresses: [{ id: 'e1', emailAddress: email }],
  };
  const event = {
    type: 'organizationMembership.created',
    data: { role: 'org:worker', organization: { id: agency.clerkOrgId }, public_user_data: { user_id: clerkUserId } },
  };

  mockGetUserFailuresLeft = 1;
  const first = await postEvent(event);
  expect(first.status).toBe(500);
  expect(await prisma.user.findUnique({ where: { clerkUserId } })).toBeNull();

  const retry = await postEvent(event);
  expect(retry.status).toBe(200);
  const user = await prisma.user.findUnique({ where: { clerkUserId } });
  expect(user).toMatchObject({ agencyId: agency.id, role: 'WORKER', status: 'ACTIVE' });
});

test('an invalid signature is still rejected with 400', async () => {
  verifyWebhook.mockRejectedValueOnce(new Error('bad signature'));
  const res = await request(app).post('/webhooks/clerk').set('Content-Type', 'application/json').send('{}');
  expect(res.status).toBe(400);
});
