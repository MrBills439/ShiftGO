const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { resolveStoredPath } = require('../lib/storage');

const STALE_AFTER_DAYS = 90;

/** Roles that must hold a Right-to-Work share code on file. */
const CHECKED_ROLES = ['WORKER', 'TEAM_LEADER'];

function ageDays(shareDate) {
  return (Date.now() - new Date(shareDate).getTime()) / 86_400_000;
}

function statusFor(record) {
  if (!record) return 'MISSING';
  return ageDays(record.shareDate) > STALE_AFTER_DAYS ? 'STALE' : 'CURRENT';
}

function decorate(record) {
  if (!record) return null;
  const age = ageDays(record.shareDate);
  return {
    id: record.id,
    userId: record.userId,
    code: record.code,
    shareDate: record.shareDate,
    notes: record.notes ?? null,
    hasDocument: Boolean(record.documentPath),
    documentName: record.documentName ?? null,
    documentUrl: record.documentPath ?? null,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy ? { id: record.updatedBy.id, name: record.updatedBy.name } : null,
    status: statusFor(record),
    daysUntilStale: Math.max(0, Math.ceil(STALE_AFTER_DAYS - age)),
    staleAfterDays: STALE_AFTER_DAYS,
  };
}

/**
 * Normalised 9-char share code, or throws a 400-flavoured error.
 * Accepts any separators the user might type ("WE4 PWW 7D6", "WE4-PWW-7D6",
 * "we4pww7d6") — everything non-alphanumeric is stripped before validation.
 */
function normaliseCode(raw) {
  const code = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{9}$/.test(code)) {
    const err = new Error('Share code must be 9 letters and numbers (e.g. W3E W7A 5X2).');
    err.statusCode = 400;
    throw err;
  }
  return code;
}

function parseShareDate(raw) {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const err = new Error('A valid share date is required.');
    err.statusCode = 400;
    throw err;
  }
  if (d.getTime() > Date.now() + 86_400_000) {
    const err = new Error('The share date cannot be in the future.');
    err.statusCode = 400;
    throw err;
  }
  return d;
}

async function assertUserInAgency(userId, agencyId) {
  const user = await prisma.user.findFirst({ where: { id: userId, agencyId } });
  if (!user) {
    const err = new Error('User must belong to your agency.');
    err.statusCode = 403;
    throw err;
  }
  return user;
}

async function getForUser(agencyId, userId) {
  const record = await prisma.shareCode.findFirst({
    where: { agencyId, userId },
    include: { updatedBy: { select: { id: true, name: true } } },
  });
  return decorate(record) ?? {
    userId,
    code: null,
    shareDate: null,
    notes: null,
    hasDocument: false,
    documentUrl: null,
    status: 'MISSING',
    staleAfterDays: STALE_AFTER_DAYS,
  };
}

async function upsert(agencyId, userId, body, updatedById) {
  await assertUserInAgency(userId, agencyId);
  const code = normaliseCode(body.code);
  const shareDate = parseShareDate(body.shareDate);
  const notes = body.notes ? String(body.notes).slice(0, 1000) : null;

  const record = await prisma.shareCode.upsert({
    where: { userId },
    create: { agencyId, userId, code, shareDate, notes, updatedById },
    update: { code, shareDate, notes, updatedById },
    include: { updatedBy: { select: { id: true, name: true } } },
  });
  return decorate(record);
}

async function setDocument(agencyId, userId, file, updatedById) {
  await assertUserInAgency(userId, agencyId);
  const existing = await prisma.shareCode.findUnique({ where: { userId } });
  if (!existing) {
    const err = new Error('Add your share code and share date before uploading the document.');
    err.statusCode = 400;
    throw err;
  }
  // The display name is echoed back in Content-Disposition on download — strip
  // any path separators and cap the length. The on-disk name is server-generated
  // (file.filename), so this only affects the label, never the storage path.
  const documentName = String(file.originalname || 'document')
    .replace(/[/\\]+/g, '_')
    .slice(0, 255);
  const record = await prisma.shareCode.update({
    where: { userId },
    data: {
      documentPath: `/uploads/rtw/${file.filename}`,
      documentName,
      updatedById,
    },
    include: { updatedBy: { select: { id: true, name: true } } },
  });
  // Only NOW, with the DB pointing at the new file, remove the previous one.
  // If the update above had thrown, the old document would still be intact.
  if (existing.documentPath && existing.documentPath !== record.documentPath) {
    const prev = resolveStoredPath(existing.documentPath);
    if (prev) fs.promises.unlink(prev).catch(() => {});
  }
  return decorate(record);
}

async function listForAgency(agencyId) {
  const workers = await prisma.user.findMany({
    where: { agencyId, status: 'ACTIVE', role: { in: CHECKED_ROLES } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
  const codes = await prisma.shareCode.findMany({
    where: { agencyId },
    include: { updatedBy: { select: { id: true, name: true } } },
  });
  const byUser = new Map(codes.map((c) => [c.userId, c]));

  const rows = workers.map((w) => {
    const decorated = decorate(byUser.get(w.id));
    return { user: w, shareCode: decorated, status: decorated?.status ?? 'MISSING' };
  });

  return {
    staleAfterDays: STALE_AFTER_DAYS,
    counts: {
      total: rows.length,
      current: rows.filter((r) => r.status === 'CURRENT').length,
      stale: rows.filter((r) => r.status === 'STALE').length,
      missing: rows.filter((r) => r.status === 'MISSING').length,
    },
    rows,
  };
}

async function resolveDocument(agencyId, userId) {
  const record = await prisma.shareCode.findFirst({ where: { agencyId, userId } });
  if (!record || !record.documentPath) return null;
  const abs = resolveStoredPath(record.documentPath);
  if (!fs.existsSync(abs)) return null;
  return { absolutePath: abs, downloadName: record.documentName || path.basename(abs) };
}

/** Streams a ZIP of every proof document in the agency into `res`. */
async function streamAgencyZip(agencyId, res) {
  const archiver = require('archiver');
  const records = await prisma.shareCode.findMany({
    where: { agencyId, documentPath: { not: null } },
    include: { user: { select: { name: true, email: true } } },
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="right-to-work-${new Date().toISOString().slice(0, 10)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('warning', (err) => { if (err.code !== 'ENOENT') throw err; });
  archive.pipe(res);

  const manifest = [['Worker', 'Email', 'Share code', 'Share date', 'Status', 'Document']];
  const usedNames = new Set();

  for (const rec of records) {
    const abs = resolveStoredPath(rec.documentPath);
    if (!fs.existsSync(abs)) continue;
    const ext = path.extname(abs) || '.pdf';
    const safe = rec.user.name.replace(/[^\w.-]+/g, '_');
    let entry = `${safe}-${rec.code}${ext}`;
    let n = 2;
    while (usedNames.has(entry)) entry = `${safe}-${rec.code}-${n++}${ext}`;
    usedNames.add(entry);
    archive.file(abs, { name: entry });
    manifest.push([
      rec.user.name,
      rec.user.email,
      rec.code,
      new Date(rec.shareDate).toISOString().slice(0, 10),
      statusFor(rec),
      entry,
    ]);
  }

  const csv = manifest
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  archive.append(csv, { name: 'manifest.csv' });

  await archive.finalize();
}

module.exports = {
  STALE_AFTER_DAYS,
  CHECKED_ROLES,
  statusFor,
  getForUser,
  upsert,
  setDocument,
  listForAgency,
  resolveDocument,
  streamAgencyZip,
};
