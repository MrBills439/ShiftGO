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
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });

let agencyA;
let agencyB;
let workerA;
let hrA;
let hrB;

const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

async function mkUser(agencyId, role, tag) {
  return prisma.user.create({
    data: { agencyId, role, name: `RTW ${tag}`, email: `rtw-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x' },
  });
}

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `RTW A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `RTW B ${suffix}` } });
  workerA = await mkUser(agencyA.id, 'WORKER', 'workerA');
  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  hrB = await mkUser(agencyB.id, 'HR', 'hrB');
});

afterEach(async () => {
  await prisma.shareCode.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

function putMine(user, body) {
  return request(app).put('/right-to-work/me').set('Authorization', `Bearer ${tokenFor(user)}`).send(body);
}

describe('PUT /right-to-work/me — share code normalisation', () => {
  test('accepts a spaced code and stores it normalised', async () => {
    const res = await putMine(workerA, { code: 'WE4 PWW 7D6', shareDate: yesterday() });
    expect(res.status).toBe(200);
    const row = await prisma.shareCode.findUnique({ where: { userId: workerA.id } });
    expect(row.code).toBe('WE4PWW7D6');
    expect(row.agencyId).toBe(agencyA.id);
    expect(row.userId).toBe(workerA.id);
  });

  test('accepts an unspaced lowercase code', async () => {
    const res = await putMine(workerA, { code: 'we4pww7d6', shareDate: yesterday() });
    expect(res.status).toBe(200);
    expect((await prisma.shareCode.findUnique({ where: { userId: workerA.id } })).code).toBe('WE4PWW7D6');
  });

  test('accepts a hyphen-separated code', async () => {
    const res = await putMine(workerA, { code: 'WE4-PWW-7D6', shareDate: yesterday() });
    expect(res.status).toBe(200);
    expect((await prisma.shareCode.findUnique({ where: { userId: workerA.id } })).code).toBe('WE4PWW7D6');
  });

  test('rejects a code that is not 9 alphanumerics, with a clear message', async () => {
    const res = await putMine(workerA, { code: 'WE4 PWW 7', shareDate: yesterday() });
    expect(res.status).toBe(400);
    expect(res.body.message || res.body.error?.message).toMatch(/9 letters and numbers/i);
    expect(await prisma.shareCode.findUnique({ where: { userId: workerA.id } })).toBeNull();
  });

  test('rejects a future share date', async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const res = await putMine(workerA, { code: 'WE4PWW7D6', shareDate: future });
    expect(res.status).toBe(400);
    expect(res.body.message || res.body.error?.message).toMatch(/future/i);
  });

  test('a successful save actually persists and is readable via GET /me', async () => {
    await putMine(workerA, { code: 'WE4 PWW 7D6', shareDate: yesterday() });
    const res = await request(app).get('/right-to-work/me').set('Authorization', `Bearer ${tokenFor(workerA)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe('WE4PWW7D6');
    expect(res.body.data.status).toBe('CURRENT');
  });
});

describe('right-to-work agency isolation', () => {
  test("another agency's HR cannot read or write this worker's share code", async () => {
    await putMine(workerA, { code: 'WE4PWW7D6', shareDate: yesterday() });

    const read = await request(app)
      .get(`/right-to-work/user/${workerA.id}`)
      .set('Authorization', `Bearer ${tokenFor(hrB)}`);
    // getForUser resolves against the caller's agency -> a MISSING record, never agency A's data.
    expect(read.body.data.code).toBeNull();

    const write = await request(app)
      .put(`/right-to-work/user/${workerA.id}`)
      .set('Authorization', `Bearer ${tokenFor(hrB)}`)
      .send({ code: 'AAA111BBB', shareDate: yesterday() });
    expect(write.status).toBe(403);

    // Agency A's row is untouched.
    expect((await prisma.shareCode.findUnique({ where: { userId: workerA.id } })).code).toBe('WE4PWW7D6');
  });

  test('the agency RTW list only contains that agency\'s checked staff', async () => {
    await putMine(workerA, { code: 'WE4PWW7D6', shareDate: yesterday() });
    const res = await request(app).get('/right-to-work').set('Authorization', `Bearer ${tokenFor(hrA)}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.rows.map((r) => r.user.id);
    expect(ids).toContain(workerA.id);
    expect(ids).not.toContain(hrB.id);
  });
});
