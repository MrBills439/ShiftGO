const service = require('../services/rightToWorkService');
const { ok, fail, notFound } = require('../utils/response');
const { canViewPersonRecords } = require('../services/accessScope');
const { auditContext, createAuditLog, logAccess } = require('../services/auditService');

// Audit summary of a right-to-work record. The share code itself is never
// copied into the log.
const rtwSummary = (r) => r && ({ shareDate: r.shareDate, status: r.status, hasDocument: Boolean(r.hasDocument) });
const { agencyIdFor } = require('../utils/agency');
const storage = require('../lib/storage');
const rtwStore = require('../lib/rtwStore');
const { validateRtwUpload } = require('../lib/fileValidation');
const { scanUploadedFile } = require('../lib/malwareScan');

/**
 * Shared pipeline for a Right-to-Work document upload.
 *
 * multer has already written the upload into RTW_QUARANTINE_DIR under a
 * server-generated random name. From there, in order:
 *   1. content validation — extension + declared MIME + size + PDF magic bytes
 *   2. malware-scan seam  — scanUploadedFile() (currently an honest no-op that
 *      reports scanned:false; a real engine plugs in here, no controller change)
 *   3. promote            — atomic fs.rename from _quarantine/ up into rtw/
 *   4. persist            — service.setDocument writes the accepted path to the DB
 *
 * Failure handling:
 *   - fails at 1/2 (still in quarantine)  -> delete the quarantine file
 *   - fails at 3 (rename)                 -> delete the quarantine file
 *   - fails at 4 (DB write, AFTER promote)-> delete the newly promoted file;
 *     the user's PREVIOUS accepted document is untouched (setDocument only
 *     removes the old file after its own DB update succeeds)
 * In every failure case NO ShareCode row is created or updated.
 */
async function acceptRtwDocument(req, res, userId) {
  if (!req.file) return fail(res, 'No document uploaded. Upload a PDF.');

  let promoted = null; // { acceptedAbsPath, webPath } once the rename succeeds
  try {
    validateRtwUpload(req.file); // reads only the first bytes of the quarantined file

    const scan = await scanUploadedFile(req.file.path);
    if (scan.scanned && !scan.clean) {
      const err = new Error('This document was rejected by the malware scanner.');
      err.statusCode = 422;
      throw err;
    }

    // _quarantine/<x>.pdf -> permanent store (local rtw/ dir, or the S3 bucket)
    promoted = await rtwStore.acceptFromQuarantine(req.file.path);

    const saved = await service.setDocument(
      agencyIdFor(req),
      userId,
      { filename: promoted.name, originalname: req.file.originalname },
      req.user.id,
    );
    await createAuditLog({
      ...auditContext(req), action: 'RTW_DOCUMENT_UPLOADED', entityType: 'ShareCode', entityId: saved.id,
      newValue: { subjectUserId: userId, documentName: saved.documentName },
    });
    ok(res, saved);
  } catch (err) {
    if (promoted) {
      // Promotion succeeded but a later step failed — remove the orphan we just
      // created. The previous accepted document is left exactly as it was.
      await promoted.discard();
    } else {
      // Still untrusted in quarantine — drop it.
      await storage.unlinkInside(storage.RTW_QUARANTINE_DIR, req.file && req.file.path);
    }
    if (err.statusCode) return fail(res, err.message, err.statusCode);
    throw err;
  }
}

async function getMine(req, res) {
  ok(res, await service.getForUser(agencyIdFor(req), req.user.id));
}

async function updateMine(req, res) {
  try {
    const saved = await service.upsert(agencyIdFor(req), req.user.id, req.body, req.user.id);
    await createAuditLog({
      ...auditContext(req), action: 'RTW_SHARE_CODE_UPDATED', entityType: 'ShareCode', entityId: saved.id,
      newValue: { subjectUserId: req.user.id, ...rtwSummary(saved) },
    });
    ok(res, saved);
  } catch (err) {
    if (err.statusCode) return fail(res, err.message, err.statusCode);
    throw err;
  }
}

async function uploadMyDocument(req, res) {
  await acceptRtwDocument(req, res, req.user.id);
}

async function list(req, res) {
  ok(res, await service.listForAgency(agencyIdFor(req)));
}

async function getForUser(req, res) {
  if (!(await canViewPersonRecords(req.user, req.params.userId, agencyIdFor(req)))) return notFound(res);
  const record = await service.getForUser(agencyIdFor(req), req.params.userId);
  if (req.params.userId !== req.user.id) {
    await logAccess(req, { action: 'RTW_RECORD_VIEWED', entityType: 'ShareCode', entityId: record.id ?? req.params.userId, subjectUserId: req.params.userId });
  }
  ok(res, record);
}

async function updateForUser(req, res) {
  try {
    const saved = await service.upsert(agencyIdFor(req), req.params.userId, req.body, req.user.id);
    await createAuditLog({
      ...auditContext(req), action: 'RTW_SHARE_CODE_UPDATED', entityType: 'ShareCode', entityId: saved.id,
      newValue: { subjectUserId: req.params.userId, ...rtwSummary(saved) },
    });
    ok(res, saved);
  } catch (err) {
    if (err.statusCode) return fail(res, err.message, err.statusCode);
    throw err;
  }
}

async function uploadUserDocument(req, res) {
  await acceptRtwDocument(req, res, req.params.userId);
}

async function getDocument(req, res) {
  const target = req.params.userId ?? req.user.id;
  if (req.params.userId && !(await canViewPersonRecords(req.user, target, agencyIdFor(req)))) {
    return fail(res, 'No document on file for this worker', 404);
  }
  const doc = await service.resolveDocument(agencyIdFor(req), target);
  if (!doc) return fail(res, 'No document on file for this worker', 404);
  await logAccess(req, { action: 'RTW_DOCUMENT_DOWNLOADED', entityType: 'ShareCode', entityId: target, subjectUserId: target });
  res.attachment(doc.downloadName); // Content-Disposition + a type from the name
  res.setHeader('Content-Type', rtwStore.contentTypeFor(doc.downloadName));
  res.setHeader('Cache-Control', 'private, no-store');
  doc.stream.on('error', (err) => {
    console.error('[rtw] document stream failed:', err.message);
    if (!res.headersSent) fail(res, 'Could not read the document', 500);
    else res.destroy(err);
  });
  doc.stream.pipe(res);
}

async function exportZip(req, res) {
  await logAccess(req, { action: 'RTW_BULK_EXPORTED', entityType: 'Agency', entityId: agencyIdFor(req) });
  await service.streamAgencyZip(agencyIdFor(req), res);
}

module.exports = {
  getMine,
  updateMine,
  uploadMyDocument,
  list,
  getForUser,
  updateForUser,
  uploadUserDocument,
  getDocument,
  exportZip,
};
