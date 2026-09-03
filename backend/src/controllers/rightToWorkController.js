const service = require('../services/rightToWorkService');
const { ok, fail } = require('../utils/response');
const { agencyIdFor } = require('../utils/agency');

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
  if (!req.file) return fail(res, 'No document uploaded. Use a PDF, JPG or PNG.');
  try {
    ok(res, await service.setDocument(agencyIdFor(req), req.user.id, req.file, req.user.id));
  } catch (err) {
    if (err.statusCode) return fail(res, err.message, err.statusCode);
    throw err;
  }
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
  if (!req.file) return fail(res, 'No document uploaded.');
  try {
    ok(res, await service.setDocument(agencyIdFor(req), req.params.userId, req.file, req.user.id));
  } catch (err) {
    if (err.statusCode) return fail(res, err.message, err.statusCode);
    throw err;
  }
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
