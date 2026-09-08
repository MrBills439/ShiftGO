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

/** Accepted Right-to-Work proof documents — served only through authenticated
 *  routes, never statically. */
const RTW_DIR = path.join(UPLOAD_DIR, 'rtw');

/** Landing zone for a NEW, still-untrusted RTW upload. A file lives here only
 *  until it has passed type + signature validation and the malware-scan seam;
 *  it is then atomically renamed up into RTW_DIR ("promoted"). Never served. */
const RTW_QUARANTINE_DIR = path.join(RTW_DIR, '_quarantine');

const ALL_DIRS = [UPLOAD_DIR, AVATARS_DIR, RTW_DIR, RTW_QUARANTINE_DIR];

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

/** True iff `abs` is a real path strictly inside `dir` (not the dir itself). */
function isInsideDir(dir, abs) {
  return typeof abs === 'string' && path.resolve(abs).startsWith(dir + path.sep);
}

/** Best-effort unlink that refuses to touch anything outside `dir`. Never throws.
 *  Returns true only if a file was actually removed. */
async function unlinkInside(dir, absPath) {
  if (!isInsideDir(dir, absPath)) return false;
  try {
    await fs.promises.unlink(path.resolve(absPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically promote a validated RTW upload from the quarantine dir into the
 * accepted RTW dir. The basename is server-generated (multer) and is preserved;
 * both the source and destination are asserted to sit in their expected
 * directories, so a tampered path can neither be read from outside quarantine
 * nor written outside RTW_DIR. Uses fs.rename (no copy / whole-file read).
 *
 * @param {string} quarantineAbsPath absolute path of the file in RTW_QUARANTINE_DIR
 * @returns {Promise<{ acceptedAbsPath: string, webPath: string }>}
 */
async function promoteRtwUpload(quarantineAbsPath) {
  const src = path.resolve(String(quarantineAbsPath || ''));
  if (!isInsideDir(RTW_QUARANTINE_DIR, src)) {
    throw new Error('promoteRtwUpload: source is not inside the quarantine directory');
  }
  const base = path.basename(src);
  const dest = path.join(RTW_DIR, base);
  // dest must be directly in RTW_DIR and must NOT land back in quarantine.
  if (!isInsideDir(RTW_DIR, dest) || isInsideDir(RTW_QUARANTINE_DIR, dest) || path.dirname(dest) !== RTW_DIR) {
    throw new Error('promoteRtwUpload: destination escapes the accepted RTW directory');
  }
  await fs.promises.rename(src, dest); // atomic within the same filesystem
  return { acceptedAbsPath: dest, webPath: `/uploads/rtw/${base}` };
}

module.exports = {
  UPLOAD_DIR,
  AVATARS_DIR,
  RTW_DIR,
  RTW_QUARANTINE_DIR,
  ensureUploadDirs,
  resolveStoredPath,
  discardUpload,
  isInsideDir,
  unlinkInside,
  promoteRtwUpload,
};
