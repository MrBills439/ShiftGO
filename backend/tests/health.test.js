process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

afterEach(() => jest.restoreAllMocks());

afterAll(() => prisma.$disconnect());

describe('GET /health', () => {
  test('healthy database -> 200 ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', app: 'ShiftGO', db: 'ok' });
    expect(typeof res.body.timestamp).toBe('string');
  });

  test('failed database check -> 503 degraded, no DB details leaked', async () => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', app: 'ShiftGO', db: 'down' });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|password|5432/);
    expect(res.body).not.toHaveProperty('error');
  });

  test('recovers on the next request once the database is reachable again', async () => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('down'));
    const bad = await request(app).get('/health');
    expect(bad.status).toBe(503);

    const good = await request(app).get('/health');
    expect(good.status).toBe(200);
    expect(good.body.db).toBe('ok');
  });
});
