/**
 * Whole-Workforce Phase 1 — Department / JobTitle / Location.
 *
 * These are ORGANISATION STRUCTURE records: tenant-scoped, company-editable,
 * with NO authorization meaning. One generic CRUD implementation serves all
 * three because their lifecycle is identical (create → list/get → update →
 * deactivate/reactivate). Referenced records are deactivated, never hard-deleted,
 * so employee history stays intact.
 */
const prisma = require('../lib/prisma');

function httpErr(message, statusCode, code) {
  const e = new Error(message);
  e.statusCode = statusCode;
  if (code) e.code = code;
  return e;
}

// Per-entity config: the Prisma delegate, the writable fields, and how to count
// live references (users / houses pointing at it) for the delete-safety rule.
const ENTITIES = {
  department: {
    model: 'department',
    label: 'Department',
    writable: ['name', 'code'],
    async refCount(id) {
      const [users, jobTitles] = await Promise.all([
        prisma.user.count({ where: { departmentId: id } }),
        prisma.jobTitle.count({ where: { departmentId: id } }),
      ]);
      return users + jobTitles;
    },
    serialize: (r) => ({
      id: r.id, name: r.name, code: r.code ?? null, active: r.active,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }),
  },
  jobTitle: {
    model: 'jobTitle',
    label: 'Job title',
    writable: ['name', 'departmentId'],
    async refCount(id) {
      return prisma.user.count({ where: { jobTitleId: id } });
    },
    include: { department: { select: { id: true, name: true } } },
    serialize: (r) => ({
      id: r.id, name: r.name, active: r.active,
      departmentId: r.departmentId ?? null,
      department: r.department ? { id: r.department.id, name: r.department.name } : null,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    }),
  },
  location: {
    model: 'location',
    label: 'Location',
    writable: ['name', 'type', 'address', 'latitude', 'longitude', 'geofenceRadius', 'timezone'],
    async refCount(id) {
      const [users, houses] = await Promise.all([
        prisma.user.count({ where: { primaryLocationId: id } }),
        prisma.house.count({ where: { locationId: id } }),
      ]);
      return users + houses;
    },
    serialize: (r) => ({
      id: r.id, name: r.name, type: r.type, address: r.address ?? null,
      latitude: r.latitude ?? null, longitude: r.longitude ?? null,
      geofenceRadius: r.geofenceRadius ?? null, timezone: r.timezone ?? null,
      active: r.active, createdAt: r.createdAt, updatedAt: r.updatedAt,
    }),
  },
};

const LOCATION_TYPES = ['CARE_SERVICE', 'SUPPORTED_LIVING', 'RESIDENTIAL_HOME', 'OFFICE', 'MAINTENANCE_BASE', 'OTHER'];

function cfg(entity) {
  const c = ENTITIES[entity];
  if (!c) throw new Error(`unknown org entity: ${entity}`);
  return c;
}

function pickWritable(entity, body) {
  const c = cfg(entity);
  const data = {};
  for (const k of c.writable) {
    if (body[k] === undefined) continue;
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '') v = k === 'name' ? v : null; // blank name is caught by validation
    data[k] = v;
  }
  return data;
}

async function assertDepartmentInAgency(departmentId, agencyId) {
  if (departmentId == null) return;
  const d = await prisma.department.findFirst({ where: { id: departmentId, agencyId }, select: { id: true } });
  if (!d) throw httpErr('That department is not in your agency', 400, 'INVALID_DEPARTMENT');
}

async function create(entity, agencyId, body) {
  const c = cfg(entity);
  const data = pickWritable(entity, body);
  if (!data.name) throw httpErr(`${c.label} name is required`, 400, 'NAME_REQUIRED');

  if (entity === 'jobTitle') await assertDepartmentInAgency(data.departmentId ?? null, agencyId);
  if (entity === 'location' && data.type && !LOCATION_TYPES.includes(data.type)) {
    throw httpErr('Invalid location type', 400, 'INVALID_TYPE');
  }

  try {
    const row = await prisma[c.model].create({
      data: { ...data, agencyId, active: true },
      ...(c.include ? { include: c.include } : {}),
    });
    return c.serialize(row);
  } catch (err) {
    if (err.code === 'P2002') throw httpErr(`A ${c.label.toLowerCase()} with that name already exists`, 409, 'DUPLICATE_NAME');
    throw err;
  }
}

async function list(entity, agencyId, { includeInactive = false } = {}) {
  const c = cfg(entity);
  const rows = await prisma[c.model].findMany({
    where: { agencyId, ...(includeInactive ? {} : { active: true }) },
    ...(c.include ? { include: c.include } : {}),
    orderBy: { name: 'asc' },
  });
  return rows.map(c.serialize);
}

/** Minimal id+name list of ACTIVE records — safe for any authenticated user to
 *  populate a picker. Never leaks another agency's records. */
async function options(entity, agencyId) {
  const c = cfg(entity);
  const rows = await prisma[c.model].findMany({
    where: { agencyId, active: true },
    select: { id: true, name: true, ...(entity === 'location' ? { type: true } : {}) },
    orderBy: { name: 'asc' },
  });
  return rows;
}

async function getOne(entity, agencyId, id) {
  const c = cfg(entity);
  const row = await prisma[c.model].findFirst({
    where: { id, agencyId },
    ...(c.include ? { include: c.include } : {}),
  });
  if (!row) throw httpErr(`${c.label} not found`, 404, 'NOT_FOUND');
  return c.serialize(row);
}

async function update(entity, agencyId, id, body) {
  const c = cfg(entity);
  const existing = await prisma[c.model].findFirst({ where: { id, agencyId }, select: { id: true } });
  if (!existing) throw httpErr(`${c.label} not found`, 404, 'NOT_FOUND');

  const data = pickWritable(entity, body);
  if ('name' in data && !data.name) throw httpErr(`${c.label} name cannot be empty`, 400, 'NAME_REQUIRED');
  if (entity === 'jobTitle' && 'departmentId' in data) await assertDepartmentInAgency(data.departmentId ?? null, agencyId);
  if (entity === 'location' && 'type' in data && !LOCATION_TYPES.includes(data.type)) {
    throw httpErr('Invalid location type', 400, 'INVALID_TYPE');
  }

  try {
    const row = await prisma[c.model].update({
      where: { id },
      data,
      ...(c.include ? { include: c.include } : {}),
    });
    return c.serialize(row);
  } catch (err) {
    if (err.code === 'P2002') throw httpErr(`A ${c.label.toLowerCase()} with that name already exists`, 409, 'DUPLICATE_NAME');
    throw err;
  }
}

/** Deactivate (active=false) — the standard way to retire an org record.
 *  Kept even when referenced, so historical staff records stay meaningful. */
async function setActive(entity, agencyId, id, active) {
  const c = cfg(entity);
  const existing = await prisma[c.model].findFirst({ where: { id, agencyId }, select: { id: true, active: true } });
  if (!existing) throw httpErr(`${c.label} not found`, 404, 'NOT_FOUND');
  if (existing.active === active) return getOne(entity, agencyId, id);
  const row = await prisma[c.model].update({
    where: { id }, data: { active },
    ...(c.include ? { include: c.include } : {}),
  });
  return c.serialize(row);
}

/** Hard delete — allowed ONLY when nothing references the record. Otherwise the
 *  caller must deactivate instead (409). */
async function remove(entity, agencyId, id) {
  const c = cfg(entity);
  const existing = await prisma[c.model].findFirst({ where: { id, agencyId }, select: { id: true } });
  if (!existing) throw httpErr(`${c.label} not found`, 404, 'NOT_FOUND');
  const refs = await c.refCount(id);
  if (refs > 0) {
    throw httpErr(
      `This ${c.label.toLowerCase()} is used by ${refs} record(s). Deactivate it instead of deleting.`,
      409, 'IN_USE',
    );
  }
  await prisma[c.model].delete({ where: { id } });
  return { id, deleted: true };
}

module.exports = {
  ENTITIES, LOCATION_TYPES,
  create, list, options, getOne, update, setActive, remove,
  assertDepartmentInAgency,
};
