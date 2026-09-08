const path = require('path');
const service = require('../services/rightToWorkService');
const { ok, fail } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');
const storage = require('../lib/storage');
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

    promoted = await storage.promoteRtwUpload(req.file.path); // _quarantine/<x>.pdf -> rtw/<x>.pdf

    const saved = await service.setDocument(
      agencyIdFor(req),
      userId,
      { filename: path.basename(promoted.acceptedAbsPath), originalname: req.file.originalname },
      req.user.id,
    );
    ok(res, saved);
  } catch (err) {
    if (promoted) {
      // Promotion succeeded but a later step failed — remove the orphan we just
      // created. The previous accepted document is left exactly as it was.
      await storage.unlinkInside(storage.RTW_DIR, promoted.acceptedAbsPath);
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
    ok(res, await service.upsert(agencyIdFor(req), req.user.id, req.body, req.user.id));
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
  ok(res, await service.getForUser(agencyIdFor(req), req.params.userId));
}

async function updateForUser(req, res) {
  try {
    ok(res, await service.upsert(agencyIdFor(req), req.params.userId, req.body, req.user.id));
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
  const doc = await service.resolveDocument(agencyIdFor(req), target);
  if (!doc) return fail(res, 'No document on file for this worker', 404);
  res.download(doc.absolutePath, doc.downloadName);
}

async function exportZip(req, res) {
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
