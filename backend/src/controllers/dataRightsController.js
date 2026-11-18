/**
 * Data-protection rights endpoints: privacy notice, subject access export,
 * account deletion requests. See the three services for the rules.
 */
const { ok, created, fail, notFound } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');
const { auditContext, createAuditLog } = require('../services/auditService');
const privacyNotice = require('../services/privacyNoticeService');
const { buildExport } = require('../services/dataExportService');
const deletion = require('../services/accountDeletionService');

const sendError = (res, err) => {
  if (err.statusCode) return fail(res, err.message, err.statusCode, err.code ? { code: err.code } : {});
  throw err;
};

// ─── Privacy notice ─────────────────────────────────────────────────────────
async function getNotice(req, res) {
  ok(res, await privacyNotice.currentNoticeFor(req.user));
}

async function acknowledgeNotice(req, res) {
  try {
    const result = await privacyNotice.acknowledge(req.user, req.body?.version);
    await createAuditLog({
      ...auditContext(req), action: 'PRIVACY_NOTICE_ACKNOWLEDGED', entityType: 'User', entityId: req.user.id,
      newValue: { version: result.version },
    });
    ok(res, result);
  } catch (err) { sendError(res, err); }
}

async function updateNotice(req, res) {
  try {
    await privacyNotice.setAgencyNotice(agencyIdFor(req), req.body?.text);
    const notice = await privacyNotice.currentNoticeFor(req.user);
    await createAuditLog({
      ...auditContext(req), action: 'PRIVACY_NOTICE_UPDATED', entityType: 'Agency', entityId: agencyIdFor(req),
      newValue: { version: notice.version, isDefault: notice.isDefault, length: notice.text.length },
    });
    ok(res, notice);
  } catch (err) { sendError(res, err); }
}

// ─── Subject access export ──────────────────────────────────────────────────
async function sendExport(req, res, userId) {
  const data = await buildExport(userId, agencyIdFor(req));
  if (!data) return notFound(res);
  await createAuditLog({
    ...auditContext(req), action: 'PERSONAL_DATA_EXPORTED', entityType: 'User', entityId: userId,
    newValue: { subjectUserId: userId, bySelf: userId === req.user.id },
  });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="shiftgo-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(JSON.stringify(data, null, 2));
}

const exportMine = (req, res) => sendExport(req, res, req.user.id);
const exportForUser = (req, res) => sendExport(req, res, req.params.id);

// ─── Account deletion requests ──────────────────────────────────────────────
async function getMyDeletionRequest(req, res) {
  ok(res, await deletion.latestForUser(req.user));
}

async function requestDeletion(req, res) {
  try {
    const r = await deletion.request(req.user, req.body?.reason);
    await createAuditLog({ ...auditContext(req), action: 'ACCOUNT_DELETION_REQUESTED', entityType: 'AccountDeletionRequest', entityId: r.id, newValue: { subjectUserId: req.user.id } });
    created(res, r);
  } catch (err) { sendError(res, err); }
}

async function cancelDeletion(req, res) {
  try {
    const r = await deletion.cancel(req.user);
    await createAuditLog({ ...auditContext(req), action: 'ACCOUNT_DELETION_CANCELLED', entityType: 'AccountDeletionRequest', entityId: r.id, newValue: { subjectUserId: req.user.id } });
    ok(res, r);
  } catch (err) { sendError(res, err); }
}

async function listDeletionRequests(req, res) {
  const status = ['PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'ALL'].includes(req.query.status) ? req.query.status : 'PENDING';
  ok(res, await deletion.listForAgency(agencyIdFor(req), status));
}

async function completeDeletion(req, res) {
  try {
    const r = await deletion.complete(req.params.id, agencyIdFor(req), req.user.id, req.body?.note?.trim() || null);
    await createAuditLog({
      ...auditContext(req), action: 'ACCOUNT_DELETION_COMPLETED', entityType: 'AccountDeletionRequest', entityId: r.id,
      newValue: { subjectUserId: r.user.id, erased: r.erased },
    });
    ok(res, r);
  } catch (err) { sendError(res, err); }
}

async function rejectDeletion(req, res) {
  const note = req.body?.note?.trim();
  if (!note) return fail(res, 'Give the employee a reason (it is sent to them).', 400);
  try {
    const r = await deletion.reject(req.params.id, agencyIdFor(req), req.user.id, note.slice(0, 1000));
    await createAuditLog({ ...auditContext(req), action: 'ACCOUNT_DELETION_REJECTED', entityType: 'AccountDeletionRequest', entityId: r.id, newValue: { subjectUserId: r.user.id } });
    ok(res, r);
  } catch (err) { sendError(res, err); }
}

module.exports = {
  getNotice, acknowledgeNotice, updateNotice, exportMine, exportForUser,
  getMyDeletionRequest, requestDeletion, cancelDeletion, listDeletionRequests, completeDeletion, rejectDeletion,
};
