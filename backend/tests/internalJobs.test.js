jest.mock('../src/jobs/jobLock', () => ({ withJobLock: jest.fn(async (_name, fn) => ({ ran: true, result: await fn() })) }));
jest.mock('../src/jobs/missedClockInJob', () => ({ missedClockInJob: jest.fn(async () => 'mc') }));
jest.mock('../src/jobs/attendanceJob', () => ({ attendanceJob: jest.fn(async () => 'att') }));

const request = require('supertest');
const app = require('../src/app');
const { withJobLock } = require('../src/jobs/jobLock');
const { attendanceJob } = require('../src/jobs/attendanceJob');

const SECRET = 'jobs-secret-for-tests-0123456789abcdef';

describe('POST /internal/jobs/:name', () => {
  afterEach(() => { delete process.env.JOBS_SECRET; });

  test('does not exist when JOBS_SECRET is not set', async () => {
    const res = await request(app).post('/internal/jobs/attendance').set('X-Jobs-Secret', 'anything');
    expect(res.status).toBe(404);
    expect(attendanceJob).not.toHaveBeenCalled();
  });

  test('wrong or missing secret is a 404 and runs nothing', async () => {
    process.env.JOBS_SECRET = SECRET;
    expect((await request(app).post('/internal/jobs/attendance').set('X-Jobs-Secret', 'nope')).status).toBe(404);
    expect((await request(app).post('/internal/jobs/attendance')).status).toBe(404);
    expect(attendanceJob).not.toHaveBeenCalled();
  });

  test('runs the named job under the cluster lock', async () => {
    process.env.JOBS_SECRET = SECRET;
    const res = await request(app).post('/internal/jobs/attendance').set('X-Jobs-Secret', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ job: 'attendance', ran: true });
    expect(withJobLock).toHaveBeenCalledWith('attendance', attendanceJob, { maxRunMs: 55_000 });
  });

  test('unknown job names (including prototype keys) are a 404', async () => {
    process.env.JOBS_SECRET = SECRET;
    for (const name of ['nope', 'constructor', '__proto__', 'toString']) {
      expect((await request(app).post(`/internal/jobs/${name}`).set('X-Jobs-Secret', SECRET)).status).toBe(404);
    }
  });
});
