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
const as = (u) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tokenFor(u)}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
  patch: (p, b) => request(app).patch(p).set('Authorization', `Bearer ${tokenFor(u)}`).send(b || {}),
  del: (p) => request(app).delete(p).set('Authorization', `Bearer ${tokenFor(u)}`),
});

let agencyA, agencyB, hrA, mgrA, wkrA, hrB;

const mkUser = (agencyId, role, tag) =>
  prisma.user.create({ data: { agencyId, role, name: `Org ${tag}`, email: `org-${tag}-${suffix}@shiftgo.test`, passwordHash: 'x' } });

beforeAll(async () => {
  agencyA = await prisma.agency.create({ data: { name: `Org A ${suffix}` } });
  agencyB = await prisma.agency.create({ data: { name: `Org B ${suffix}` } });
  hrA = await mkUser(agencyA.id, 'HR', 'hrA');
  mgrA = await mkUser(agencyA.id, 'MANAGER', 'mgrA');
  wkrA = await mkUser(agencyA.id, 'WORKER', 'wkrA');
  hrB = await mkUser(agencyB.id, 'HR', 'hrB');
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.user.updateMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } }, data: { departmentId: null, jobTitleId: null, primaryLocationId: null } });
  await prisma.jobTitle.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.department.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.location.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { agencyId: { in: [agencyA.id, agencyB.id] } } });
  await prisma.agency.deleteMany({ where: { id: { in: [agencyA.id, agencyB.id] } } });
  await prisma.$disconnect();
});

// ─────────────────────────── DEPARTMENTS ───────────────────────────────────
describe('Departments', () => {
  test('HR creates; MANAGER can read; WORKER cannot read the management list but can read options', async () => {
    const c = await as(hrA).post('/departments', { name: 'Care', code: 'CARE' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ name: 'Care', code: 'CARE', active: true });

    expect((await as(mgrA).get('/departments')).status).toBe(200);
    expect((await as(mgrA).get(`/departments/${c.body.data.id}`)).status).toBe(200);

    expect((await as(wkrA).get('/departments')).status).toBe(403);
    const opts = await as(wkrA).get('/departments/options');
    expect(opts.status).toBe(200);
    expect(opts.body.data.map((d) => d.name)).toContain('Care');
  });

  test('WORKER and MANAGER cannot write', async () => {
    expect((await as(wkrA).post('/departments', { name: 'Nope Dept' })).status).toBe(403);
    expect((await as(mgrA).post('/departments', { name: 'Nope Dept 2' })).status).toBe(403);
  });

  test('duplicate name in the same agency is rejected; same name in another agency is fine', async () => {
    expect((await as(hrA).post('/departments', { name: 'HR' })).status).toBe(201);
    const dup = await as(hrA).post('/departments', { name: 'HR' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE_NAME');
    expect((await as(hrB).post('/departments', { name: 'HR' })).status).toBe(201);
  });

  test('deactivate then reactivate; deactivated is hidden from the default list + options', async () => {
    const { body: { data: d } } = await as(hrA).post('/departments', { name: 'Legacy' });
    expect((await as(hrA).post(`/departments/${d.id}/deactivate`)).body.data.active).toBe(false);
    let list = await as(hrA).get('/departments');
    expect(list.body.data.find((x) => x.id === d.id)).toBeUndefined();
    list = await as(hrA).get('/departments?status=all');
    expect(list.body.data.find((x) => x.id === d.id)).toBeTruthy();
    expect((await as(hrA).post(`/departments/${d.id}/reactivate`)).body.data.active).toBe(true);
  });

  test('a referenced department cannot be hard-deleted (deactivate instead); an unreferenced one can', async () => {
    const { body: { data: used } } = await as(hrA).post('/departments', { name: 'Used' });
    await prisma.user.update({ where: { id: wkrA.id }, data: { departmentId: used.id } });
    const del = await as(hrA).del(`/departments/${used.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('IN_USE');

    const { body: { data: free } } = await as(hrA).post('/departments', { name: 'Free' });
    expect((await as(hrA).del(`/departments/${free.id}`)).status).toBe(200);
  });

  test('agency isolation / IDOR: agency B HR cannot read, update or deactivate agency A departments', async () => {
    const { body: { data: d } } = await as(hrA).post('/departments', { name: 'Secret' });
    expect((await as(hrB).get(`/departments/${d.id}`)).status).toBe(404);
    expect((await as(hrB).patch(`/departments/${d.id}`, { name: 'Hijacked' })).status).toBe(404);
    expect((await as(hrB).post(`/departments/${d.id}/deactivate`)).status).toBe(404);
    expect((await prisma.department.findUnique({ where: { id: d.id } })).name).toBe('Secret');
  });
});

// ─────────────────────────── JOB TITLES ────────────────────────────────────
describe('Job Titles', () => {
  test('CRUD + optional department validation; a cross-agency department is rejected', async () => {
    const { body: { data: deptA } } = await as(hrA).post('/departments', { name: 'Care' });
    const { body: { data: deptB } } = await as(hrB).post('/departments', { name: 'Care' });

    const ok = await as(hrA).post('/job-titles', { name: 'Support Worker', departmentId: deptA.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ name: 'Support Worker', department: { id: deptA.id, name: 'Care' } });

    const cross = await as(hrA).post('/job-titles', { name: 'PBS Lead', departmentId: deptB.id });
    expect(cross.status).toBe(400);
    expect(cross.body.code).toBe('INVALID_DEPARTMENT');

    // No department is allowed.
    expect((await as(hrA).post('/job-titles', { name: 'IT Support Engineer' })).status).toBe(201);
  });

  test('MANAGER reads, WORKER options-only, HR-only writes, agency isolation', async () => {
    const { body: { data: jt } } = await as(hrA).post('/job-titles', { name: 'Registered Manager' });
    expect((await as(mgrA).get('/job-titles')).status).toBe(200);
    expect((await as(wkrA).get('/job-titles')).status).toBe(403);
    expect((await as(wkrA).get('/job-titles/options')).status).toBe(200);
    expect((await as(mgrA).post('/job-titles', { name: 'Nope Title' })).status).toBe(403);
    expect((await as(hrB).patch(`/job-titles/${jt.id}`, { name: 'nope' })).status).toBe(404);
  });
});

// ─────────────────────────── LOCATIONS ─────────────────────────────────────
describe('Locations', () => {
  test('CRUD with type validation; geofence fields are stored but noted as not driving clock-in', async () => {
    const c = await as(hrA).post('/locations', {
      name: 'Head Office', type: 'OFFICE', address: '1 High St',
      latitude: 51.28, longitude: 1.08, geofenceRadius: 75, timezone: 'Europe/London',
    });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ name: 'Head Office', type: 'OFFICE', geofenceRadius: 75 });

    const bad = await as(hrA).post('/locations', { name: 'Nowhere', type: 'PLANET' });
    expect(bad.status).toBe(400);

    const upd = await as(hrA).patch(`/locations/${c.body.data.id}`, { type: 'MAINTENANCE_BASE' });
    expect(upd.body.data.type).toBe('MAINTENANCE_BASE');
  });

  test('agency isolation + role guards + options', async () => {
    const { body: { data: l } } = await as(hrA).post('/locations', { name: 'Canterbury Service', type: 'CARE_SERVICE' });
    expect((await as(hrB).get(`/locations/${l.id}`)).status).toBe(404);
    expect((await as(wkrA).get('/locations')).status).toBe(403);
    const opts = await as(wkrA).get('/locations/options');
    expect(opts.status).toBe(200);
    expect(opts.body.data[0]).toHaveProperty('type');
    expect((await as(mgrA).post('/locations', { name: 'Nope Loc', type: 'OTHER' })).status).toBe(403);
  });

  test('a referenced location is protected from hard delete', async () => {
    const { body: { data: l } } = await as(hrA).post('/locations', { name: 'Linked', type: 'OFFICE' });
    await prisma.user.update({ where: { id: wkrA.id }, data: { primaryLocationId: l.id } });
    const del = await as(hrA).del(`/locations/${l.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('IN_USE');
  });
});
