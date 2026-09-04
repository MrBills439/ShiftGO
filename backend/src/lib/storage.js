/**
 * Local-disk upload storage locations.
 *
 * Every persistent uploaded file (avatars, Right-to-Work proof documents) lives
 * under a single base directory:
 *
 *   - default (local dev / test):  backend/uploads
 *   - production (Railway volume):  set UPLOAD_DIR=/app/uploads
 *
 * The base directory is resolved once in config (`config.uploadDir`). This module
 * derives the per-feature sub-directories, guarantees they exist, and maps the
 * `/uploads/...` web paths stored in the database back to absolute file paths.
 *
 * NOTE: this is deliberately local-disk only. Swapping in S3 / R2 later means
 * replacing this module + the multer storage engines, nothing else.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

/** Absolute base directory for all uploads. */
const UPLOAD_DIR = config.uploadDir;

/** Profile / avatar images — served publicly via express.static. */
const AVATARS_DIR = path.join(UPLOAD_DIR, 'avatars');

/** Right-to-Work proof documents — served only through authenticated routes. */
const RTW_DIR = path.join(UPLOAD_DIR, 'rtw');

const ALL_DIRS = [UPLOAD_DIR, AVATARS_DIR, RTW_DIR];

/** Create the upload directories if they don't exist yet. Safe to call repeatedly
 *  (recursive mkdir is idempotent). Called at server startup and when the upload
 *  middleware is first loaded, so a fresh Railway volume is ready before the first
 *  request. */
function ensureUploadDirs() {
  for (const dir of ALL_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Map a stored web path (e.g. "/uploads/rtw/abc.pdf") to an absolute path under
 *  the current UPLOAD_DIR. Existing DB rows keep working when UPLOAD_DIR changes
 *  because only the "/uploads/" prefix is meaningful — the rest is re-based here.
 *
 *  Path-traversal safe: the resolved path is asserted to stay inside UPLOAD_DIR.
 *  A value that would escape (e.g. "/uploads/../../etc/passwd", or a tampered DB
 *  row) yields `null` rather than a path outside the upload tree. Every caller
 *  already degrades gracefully on a null/missing path (existsSync → 404 / skip). */
function resolveStoredPath(webPath) {
  const rel = String(webPath || '').replace(/^\/?uploads\//, '');
  const abs = path.resolve(UPLOAD_DIR, rel);
  // Must resolve to a file strictly *inside* UPLOAD_DIR — never the dir itself,
  // never a sibling/parent (path traversal).
  if (!abs.startsWith(UPLOAD_DIR + path.sep)) {
    console.warn('[storage] rejected out-of-tree upload path:', webPath);
    return null;
  }
  return abs;
}

/** Best-effort removal of a just-uploaded file. Used to avoid orphaning a file on
 *  disk when the follow-up database write fails. Never throws. */
async function discardUpload(file) {
  if (!file || !file.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch {
    /* already gone / never written — nothing to do */
  }
}

module.exports = {
  UPLOAD_DIR,
  AVATARS_DIR,
  RTW_DIR,
  ensureUploadDirs,
  resolveStoredPath,
  discardUpload,
};
