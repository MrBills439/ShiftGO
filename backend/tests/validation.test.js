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
let manager;
let worker;

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

describe('Backend HTTP setup', () => {
  it('returns health status without starting a separate server', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      status: 'ok',
      app: 'ShiftGO',
    }));
  });

  it('returns structured 404 for unknown routes', async () => {
    const res = await request(app).get('/not-a-real-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'NOT_FOUND',
        message: 'Route GET /not-a-real-route not found',
      }),
    }));
  });
});

describe('Validation and auth middleware', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Validation Agency ${suffix}` } });
    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Validation Manager',
        email: `validation-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });
    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Validation Worker',
        email: `validation-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { agencyId: agency?.id } });
    if (agency) await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  it('returns 401 when a protected route has no auth token', async () => {
    const res = await request(app).get('/houses');

    expect(res.status).toBe(401);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      message: 'Unauthorized',
    }));
  });

  it('returns 403 when a worker hits a manager-only route', async () => {
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      message: 'Forbidden',
    }));
  });

  it('returns 400 when rejecting a timesheet without a reason', async () => {
    const res = await request(app)
      .post('/timesheets/test-timesheet-id/reject')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_ERROR',
    }));
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      reason: 'Rejection reason is required',
    }));
  });

  it('returns 400 for invalid shift ID params', async () => {
    const res = await request(app)
      .get('/shifts/bad')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'VALIDATION_ERROR',
    }));
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      id: 'Shift ID must be valid',
    }));
  });

  it('returns 400 for invalid GPS coordinates', async () => {
    const res = await request(app)
      .post('/clock/location')
      .set('Authorization', `Bearer ${tokenFor(worker)}`)
      .send({ shiftId: 'shift-000000', latitude: 91, longitude: 0, accuracy: 25 });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      latitude: 'Latitude must be between -90 and 90',
    }));
  });

  it('returns 400 when shift end time is before start time', async () => {
    const res = await request(app)
      .post('/shifts')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({
        workerId: 'valid-worker-id',
        houseId: 'valid-house-id',
        date: '2026-06-27T00:00:00.000Z',
        startTime: '2026-06-27T17:00:00.000Z',
        endTime: '2026-06-27T09:00:00.000Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      endTime: 'End time must be after start time',
    }));
  });

  it('returns 400 for an empty cancellation reason', async () => {
    const res = await request(app)
      .delete('/shifts/valid-shift-id')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      reason: 'Cancellation reason is required',
    }));
  });

  it('returns 400 for a too-short timesheet rejection reason', async () => {
    const res = await request(app)
      .post('/timesheets/valid-timesheet-id/reject')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'no' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      reason: 'Rejection reason must be between 3 and 500 characters',
    }));
  });

  it('returns 400 for invalid role query values', async () => {
    const res = await request(app)
      .get('/users?role=ADMIN')
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      role: 'Role must be WORKER, TEAM_LEADER, MANAGER, or HR',
    }));
  });

  it('returns 400 for invalid pagination query values', async () => {
    const res = await request(app)
      .get('/notifications?limit=1000&page=0')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.objectContaining({
      limit: 'Limit must be an integer between 1 and 100',
      page: 'Page must be an integer between 1 and 10000',
    }));
  });
});
