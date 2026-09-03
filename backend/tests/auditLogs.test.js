process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/app');
const { signAccess } = require('../src/utils/jwt');
const { createAuditLog } = require('../src/services/auditService');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let agency;
let manager;
let worker;
let house;
let shiftToCancel;
let timesheetToReject;
let timesheetToApprove;
let timesheetShift;
let approvalShift;

function tokenFor(user) {
  return signAccess({
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  });
}

describe('Audit logs', () => {
  beforeAll(async () => {
    agency = await prisma.agency.create({ data: { name: `Audit Agency ${suffix}` } });

    manager = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Audit Manager',
        email: `audit-manager-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'MANAGER',
      },
    });

    worker = await prisma.user.create({
      data: {
        agencyId: agency.id,
        name: 'Audit Worker',
        email: `audit-worker-${suffix}@shiftgo.test`,
        passwordHash: 'test-password-hash',
        role: 'WORKER',
      },
    });

    house = await prisma.house.create({
      data: {
        agencyId: agency.id,
        name: `Audit House ${suffix}`,
        address: '8 Audit Street',
        latitude: 51.5,
        longitude: -0.12,
        managerId: manager.id,
      },
    });

    const now = Date.now();
    shiftToCancel = await prisma.shift.create({
      data: {
        agencyId: agency.id,
        houseId: house.id,
        workerId: worker.id,
        createdById: manager.id,
        date: new Date(now + 86_400_000),
        startTime: new Date(now + 86_400_000),
        endTime: new Date(now + 90_000_000),
        status: 'SCHEDULED',
      },
    });

    timesheetShift = await prisma.shift.create({
      data: {
        agencyId: agency.id,
        houseId: house.id,
        workerId: worker.id,
        createdById: manager.id,
        date: new Date(now - 86_400_000),
        startTime: new Date(now - 90_000_000),
        endTime: new Date(now - 86_400_000),
        status: 'COMPLETED',
      },
    });

    timesheetToReject = await prisma.timesheet.create({
      data: {
        agencyId: agency.id,
        workerId: worker.id,
        houseId: house.id,
        shiftId: timesheetShift.id,
        clockInAt: new Date(now - 90_000_000),
        clockOutAt: new Date(now - 86_400_000),
        totalHours: 1,
        status: 'PENDING',
      },
    });

    approvalShift = await prisma.shift.create({
      data: {
        agencyId: agency.id,
        houseId: house.id,
        workerId: worker.id,
        createdById: manager.id,
        date: new Date(now - 172_800_000),
        startTime: new Date(now - 176_400_000),
        endTime: new Date(now - 172_800_000),
        status: 'COMPLETED',
      },
    });

    timesheetToApprove = await prisma.timesheet.create({
      data: {
        agencyId: agency.id,
        workerId: worker.id,
        houseId: house.id,
        shiftId: approvalShift.id,
        clockInAt: new Date(now - 176_400_000),
        clockOutAt: new Date(now - 172_800_000),
        totalHours: 1,
        status: 'PENDING',
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: [manager?.id, worker?.id].filter(Boolean) } },
          { entityId: { in: [shiftToCancel?.id, timesheetToReject?.id, timesheetToApprove?.id].filter(Boolean) } },
        ],
      },
    });
    await prisma.timesheet.deleteMany({ where: { workerId: worker?.id } });
    await prisma.shift.deleteMany({ where: { houseId: house?.id } });
    if (house) await prisma.house.delete({ where: { id: house.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager?.id, worker?.id].filter(Boolean) } } });
    if (agency) await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  it('creates an audit log when a shift is cancelled', async () => {
    const res = await request(app)
      .delete(`/shifts/${shiftToCancel.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .set('User-Agent', 'audit-test-agent')
      .send({ reason: 'Audit cancellation test' });

    expect(res.status).toBe(200);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'SHIFT_CANCELLED',
        entityType: 'Shift',
        entityId: shiftToCancel.id,
      },
    });

    expect(auditLog).toEqual(expect.objectContaining({
      actorId: manager.id,
      actorRole: 'MANAGER',
      action: 'SHIFT_CANCELLED',
      entityType: 'Shift',
      entityId: shiftToCancel.id,
      userAgent: 'audit-test-agent',
    }));
    expect(auditLog.oldValue.status).toBe('SCHEDULED');
    expect(auditLog.newValue.status).toBe('CANCELLED');
  });

  it('allows a manager to approve a pending timesheet and records an audit log', async () => {
    const res = await request(app)
      .post(`/timesheets/${timesheetToApprove.id}/confirm`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      id: timesheetToApprove.id,
      status: 'APPROVED',
      confirmedById: manager.id,
      reviewedById: manager.id,
    }));
    expect(res.body.data.confirmedAt).toBeTruthy();
    expect(res.body.data.reviewedAt).toBeTruthy();
    expect(res.body.data.reviewedBy).toEqual(expect.objectContaining({
      id: manager.id,
      email: manager.email,
    }));

    const updated = await prisma.timesheet.findUnique({ where: { id: timesheetToApprove.id } });
    expect(updated.status).toBe('APPROVED');
    expect(updated.confirmedById).toBe(manager.id);
    expect(updated.reviewedById).toBe(manager.id);
    expect(updated.confirmedAt).toBeTruthy();
    expect(updated.reviewedAt).toBeTruthy();

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'TIMESHEET_APPROVED',
        entityType: 'Timesheet',
        entityId: timesheetToApprove.id,
      },
    });

    expect(auditLog).toEqual(expect.objectContaining({
      actorId: manager.id,
      actorRole: 'MANAGER',
      action: 'TIMESHEET_APPROVED',
      entityType: 'Timesheet',
      entityId: timesheetToApprove.id,
    }));
    expect(auditLog.oldValue.status).toBe('PENDING');
    expect(auditLog.newValue.status).toBe('APPROVED');
  });

  it('creates an audit log when a timesheet is rejected', async () => {
    const res = await request(app)
      .post(`/timesheets/${timesheetToReject.id}/reject`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ reason: 'Hours need manager review' });

    expect(res.status).toBe(200);

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'TIMESHEET_REJECTED',
        entityType: 'Timesheet',
        entityId: timesheetToReject.id,
      },
    });

    expect(auditLog).toEqual(expect.objectContaining({
      actorId: manager.id,
      actorRole: 'MANAGER',
      action: 'TIMESHEET_REJECTED',
      entityType: 'Timesheet',
      entityId: timesheetToReject.id,
    }));
    expect(auditLog.oldValue.status).toBe('PENDING');
    expect(auditLog.newValue.status).toBe('REJECTED');
  });

  it('blocks workers from viewing audit logs', async () => {
    const res = await request(app)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${tokenFor(worker)}`);

    expect(res.status).toBe(403);
  });

  it('allows managers to view and filter audit logs', async () => {
    const res = await request(app)
      .get(`/audit-logs?entityType=Shift&entityId=${shiftToCancel.id}`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'SHIFT_CANCELLED',
        entityType: 'Shift',
        entityId: shiftToCancel.id,
      }),
    ]));
  });

  it('does not throw when audit persistence fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await createAuditLog({
      actorId: manager.id,
      actorRole: 'MANAGER',
      action: 'AUDIT_FAILURE_TEST',
      entityType: 'Test',
      entityId: 'test-entity',
    }, {
      auditLog: {
        create: jest.fn().mockRejectedValue(new Error('database unavailable')),
      },
    });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[AuditLog] failed to create audit log:',
      'database unavailable',
    );
    errorSpy.mockRestore();
  });
});
