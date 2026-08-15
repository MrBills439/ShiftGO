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
let worker;
let otherWorker;
let manager;
let house;

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

describe('Leave Requests', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Leave Agency ${suffix}` } });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Leave Worker',
        email: `leave-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-hash',
        role: 'WORKER',
      },
    });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Leave Manager',
        email: `leave-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-hash',
        role: 'MANAGER',
      },
    });

    otherWorker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Other Leave Worker',
        email: `other-leave-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-hash',
        role: 'WORKER',
      },
    });

    house = await prisma.house.create({
      data: {
        agencyId: agency.id,
        name: `Leave House ${suffix}`,
        address: '123 Main St',
        latitude: 51.5074,
        longitude: -0.1278,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { agencyId: agency?.id } });
    await prisma.leaveRequest.deleteMany({ where: { agencyId: agency?.id } });
    await prisma.shift.deleteMany({ where: { agencyId: agency?.id } });
    await prisma.house.deleteMany({ where: { agencyId: agency?.id } });
    await prisma.user.deleteMany({ where: { agencyId: agency?.id } });
    if (agency) await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  describe('POST /leave-requests', () => {
    it('worker can create own leave request', async () => {
      const startDate = new Date('2026-07-01T00:00:00Z');
      const endDate = new Date('2026-07-05T23:59:59Z');

      const res = await request(app)
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenFor(worker)}`)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          reason: 'Summer vacation',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        workerId: worker.id,
        status: 'PENDING',
        reason: 'Summer vacation',
      });
    });

    it('manager can create leave request for same-agency worker', async () => {
      const startDate = new Date('2026-08-01T00:00:00Z');
      const endDate = new Date('2026-08-05T23:59:59Z');

      const res = await request(app)
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenFor(manager)}`)
        .send({
          workerId: worker.id,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          reason: 'Medical appointment',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.workerId).toBe(worker.id);
    });

    it('rejects end date before start date', async () => {
      const startDate = new Date('2026-07-10T00:00:00Z');
      const endDate = new Date('2026-07-05T23:59:59Z');

      const res = await request(app)
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenFor(worker)}`)
        .send({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          reason: 'Bad dates',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('End date must be same or after start date');
    });

    it('rejects short reason', async () => {
      const res = await request(app)
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenFor(worker)}`)
        .send({
          startDate: new Date('2026-09-01').toISOString(),
          endDate: new Date('2026-09-05').toISOString(),
          reason: 'ok',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /leave-requests', () => {
    beforeAll(async () => {
      await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2026-10-01'),
          endDate: new Date('2026-10-05'),
          reason: 'Test leave',
          status: 'PENDING',
        },
      });

      await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: otherWorker.id,
          startDate: new Date('2026-10-10'),
          endDate: new Date('2026-10-12'),
          reason: 'Other worker leave',
          status: 'PENDING',
        },
      });
    });

    it('worker sees only own leave requests', async () => {
      const res = await request(app)
        .get('/leave-requests')
        .set('Authorization', `Bearer ${tokenFor(worker)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((item) => item.workerId === worker.id)).toBe(true);
      expect(res.body.data.map((item) => item.workerId)).not.toContain(otherWorker.id);
    });

    it('manager sees all agency leave requests', async () => {
      const res = await request(app)
        .get('/leave-requests')
        .set('Authorization', `Bearer ${tokenFor(manager)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('POST /leave-requests/:id/approve', () => {
    let pendingLeave;

    beforeAll(async () => {
      pendingLeave = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2026-11-01'),
          endDate: new Date('2026-11-05'),
          reason: 'To be approved',
          status: 'PENDING',
        },
      });
    });

    it('manager can approve leave request', async () => {
      const res = await request(app)
        .post(`/leave-requests/${pendingLeave.id}/approve`)
        .set('Authorization', `Bearer ${tokenFor(manager)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');
      expect(res.body.data.reviewedById).toBe(manager.id);
    });

    it('worker cannot approve leave request', async () => {
      const newPending = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2026-12-01'),
          endDate: new Date('2026-12-05'),
          reason: 'Cannot be approved by worker',
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post(`/leave-requests/${newPending.id}/approve`)
        .set('Authorization', `Bearer ${tokenFor(worker)}`);

      expect(res.status).toBe(403);
    });

    it('returns 409 if worker has scheduled shifts during leave', async () => {
      const leaveStart = new Date('2026-07-20T00:00:00Z');
      const leaveEnd = new Date('2026-07-25T23:59:59Z');

      const leave = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: leaveStart,
          endDate: leaveEnd,
          reason: 'Leave with conflict',
          status: 'PENDING',
        },
      });

      // Create overlapping shift
      await prisma.shift.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          houseId: house.id,
          createdById: manager.id,
          startTime: new Date('2026-07-22T09:00:00Z'),
          endTime: new Date('2026-07-22T17:00:00Z'),
          date: new Date('2026-07-22'),
        },
      });

      const res = await request(app)
        .post(`/leave-requests/${leave.id}/approve`)
        .set('Authorization', `Bearer ${tokenFor(manager)}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('scheduled shifts');
    });
  });

  describe('POST /leave-requests/:id/reject', () => {
    let pendingLeave;

    beforeAll(async () => {
      pendingLeave = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2027-01-01'),
          endDate: new Date('2027-01-05'),
          reason: 'To be rejected',
          status: 'PENDING',
        },
      });
    });

    it('manager can reject leave request with reason', async () => {
      const res = await request(app)
        .post(`/leave-requests/${pendingLeave.id}/reject`)
        .set('Authorization', `Bearer ${tokenFor(manager)}`)
        .send({ rejectionReason: 'Peak season, cannot approve' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.rejectionReason).toBe('Peak season, cannot approve');
    });

    it('rejects rejection without reason', async () => {
      const newPending = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2027-02-01'),
          endDate: new Date('2027-02-05'),
          reason: 'Another leave',
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post(`/leave-requests/${newPending.id}/reject`)
        .set('Authorization', `Bearer ${tokenFor(manager)}`)
        .send({ rejectionReason: '' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /leave-requests/:id/cancel', () => {
    it('worker can cancel own pending leave', async () => {
      const leave = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2027-03-01'),
          endDate: new Date('2027-03-05'),
          reason: 'Cancellable leave',
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post(`/leave-requests/${leave.id}/cancel`)
        .set('Authorization', `Bearer ${tokenFor(worker)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('worker cannot cancel approved leave', async () => {
      const approved = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2027-04-01'),
          endDate: new Date('2027-04-05'),
          reason: 'Approved leave',
          status: 'APPROVED',
        },
      });

      const res = await request(app)
        .post(`/leave-requests/${approved.id}/cancel`)
        .set('Authorization', `Bearer ${tokenFor(worker)}`);

      expect(res.status).toBe(400);
    });

    it('manager can cancel approved leave', async () => {
      const approved = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2027-05-01'),
          endDate: new Date('2027-05-05'),
          reason: 'Approved by manager',
          status: 'APPROVED',
        },
      });

      const res = await request(app)
        .post(`/leave-requests/${approved.id}/cancel`)
        .set('Authorization', `Bearer ${tokenFor(manager)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CANCELLED');
    });
  });

  describe('Shift creation with leave conflicts', () => {
    it('rejects shift creation if worker has approved leave', async () => {
      const leave = await prisma.leaveRequest.create({
        data: {
          agencyId: agency.id,
          workerId: worker.id,
          startDate: new Date('2027-06-15'),
          endDate: new Date('2027-06-20'),
          reason: 'Summer break',
          status: 'APPROVED',
        },
      });

      const res = await request(app)
        .post('/shifts')
        .set('Authorization', `Bearer ${tokenFor(manager)}`)
        .send({
          workerId: worker.id,
          houseId: house.id,
          startTime: new Date('2027-06-17T09:00:00Z').toISOString(),
          endTime: new Date('2027-06-17T17:00:00Z').toISOString(),
          date: new Date('2027-06-17').toISOString(),
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('approved leave');
    });
  });
});
