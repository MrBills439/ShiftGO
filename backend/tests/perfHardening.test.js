process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const fs = require('fs');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const logger = require('../src/lib/logger');
const agencyCache = require('../src/lib/agencyCache');
const storage = require('../src/lib/storage');
const { signAccess } = require('../src/utils/jwt');
const { agencyWeekRange, ymdInZone } = require('../src/lib/agencyTime');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tokenFor = (u) => signAccess({ id: u.id, agencyId: u.agencyId, role: u.role, status: u.status, name: u.name, email: u.email });

const weekParam = (() => {
  const start = agencyWeekRange('Europe/London', new Date()).start;
  const { year, month, day } = ymdInZone('Europe/London', new Date(start.getTime() + 12 * 3600_000));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
})();

const PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG signature — enough for the mime/ext filter

let agency;
let hr;
let worker;
const writtenAvatars = [];

beforeAll(async () => {
  agency = await prisma.agency.create({
    data: { name: `Perf ${suffix}`, timezone: 'Europe/London', maxWeeklyScheduledHours: 60 },
  });
  hr = await prisma.user.create({
    data: { agencyId: agency.id, role: 'HR', name: 'Perf HR', email: `perf-hr-${suffix}@shiftgo.test`, passwordHash: 'x' },
  });
  worker = await prisma.user.create({
    data: { agencyId: agency.id, role: 'WORKER', name: 'Perf W', email: `perf-w-${suffix}@shiftgo.test`, passwordHash: 'x' },
  });
});

afterAll(async () => {
  for (const p of writtenAvatars) {
    const abs = storage.resolveStoredPath(p);
    if (abs) { try { fs.unlinkSync(abs); } catch { /* noop */ } }
  }
  await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
  await prisma.user.deleteMany({ where: { agencyId: agency.id } });
  await prisma.agency.deleteMany({ where: { id: agency.id } });
  await prisma.$disconnect();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.METRICS_TOKEN;
});

describe('GET /metrics — token gated', () => {
  test('404 when METRICS_TOKEN is not configured', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(404);
  });

  test('token is accepted ONLY via the x-metrics-token header', async () => {
    process.env.METRICS_TOKEN = 'sekret-123';

    // Missing header, wrong header, and the query parameter are all rejected.
    expect((await request(app).get('/metrics')).status).toBe(404);
    expect((await request(app).get('/metrics').set('x-metrics-token', 'nope')).status).toBe(404);
    expect((await request(app).get('/metrics?token=sekret-123')).status).toBe(404);

    // Correct header -> metrics returned.
    const ok = await request(app).get('/metrics').set('x-metrics-token', 'sekret-123');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(
      expect.objectContaining({
        requests: expect.any(Number),
        errors: expect.any(Number),
        slowRequests: expect.any(Number),
        avgRequestMs: expect.any(Number),
        uptimeSeconds: expect.any(Number),
      }),
    );
  });

  test('request logger never logs the x-metrics-token header', async () => {
    process.env.METRICS_TOKEN = 'sekret-123';
    const spy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    await request(app).get('/metrics').set('x-metrics-token', 'sekret-123');

    const call = spy.mock.calls.find((c) => c[0] === 'request');
    expect(call).toBeTruthy();
    expect(JSON.stringify(call[1])).not.toContain('sekret-123');
  });
});

describe('GET /health — contract preserved behind the new middleware', () => {
  test('still returns the DB-aware payload', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ status: 'ok', app: 'ShiftGO', db: 'ok', timestamp: expect.any(String) }),
    );
  });
});

describe('request logging — no secrets', () => {
  test('logged entry carries only whitelisted fields and no query string', async () => {
    const spy = jest.spyOn(logger, 'info').mockImplementation(() => {});
    await request(app)
      .get('/health?token=super-secret-value')
      .set('Authorization', 'Bearer should-never-be-logged');

    const call = spy.mock.calls.find((c) => c[0] === 'request');
    expect(call).toBeTruthy();
    const entry = call[1];
    expect(Object.keys(entry).sort()).toEqual(
      ['agencyId', 'durationMs', 'method', 'path', 'requestId', 'status', 'userId'].sort(),
    );
    expect(entry.path).not.toContain('?');
    expect(JSON.stringify(entry)).not.toContain('super-secret-value');
    expect(JSON.stringify(entry)).not.toContain('should-never-be-logged');
  });
});

describe('avatar static mount — immutable long-cache headers', () => {
  test('served with public, max-age=31536000, immutable + cross-origin CORP', async () => {
    const up = await request(app)
      .post('/users/me/avatar')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    const url = up.body.data.profilePicture;
    writtenAvatars.push(url);
    expect(url).toMatch(/^\/uploads\/avatars\/[0-9a-f]+\.png$/); // random, version-like name

    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

describe('agency settings cache — immediate invalidation on PATCH', () => {
  test('a PATCH /agency change is visible on the very next allocation read', async () => {
    // Warm the cache via a path that reads agency settings through agencyCache.
    const first = await request(app)
      .get(`/staff/allocation?week=${weekParam}`)
      .set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(first.status).toBe(200);
    expect(first.body.data.maxWeeklyScheduledHours).toBe(60);

    const patch = await request(app)
      .patch('/agency')
      .set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({ maxWeeklyScheduledHours: 45 });
    expect(patch.status).toBe(200);

    // Without invalidation the 60s TTL would still serve 60 here.
    const second = await request(app)
      .get(`/staff/allocation?week=${weekParam}`)
      .set('Authorization', `Bearer ${tokenFor(hr)}`);
    expect(second.body.data.maxWeeklyScheduledHours).toBe(45);

    // Reset for any other suite ordering.
    await request(app)
      .patch('/agency')
      .set('Authorization', `Bearer ${tokenFor(hr)}`)
      .send({ maxWeeklyScheduledHours: 60 });
    agencyCache.invalidateAll();
  });
});
