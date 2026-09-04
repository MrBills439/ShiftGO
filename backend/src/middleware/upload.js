const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { AVATARS_DIR, RTW_DIR, ensureUploadDirs } = require('../lib/storage');

// multer.diskStorage does not create the destination directory itself, so make
// sure every upload directory exists before any request is handled. On a fresh
// Railway volume (UPLOAD_DIR=/app/uploads) these won't exist yet.
ensureUploadDirs();

// Accepted content types → canonical on-disk extension. Both the declared MIME
// type AND the original extension must be on the list; the file is then stored
// under a random name with the extension derived from the MIME map (never from
// the client-supplied filename), so a spoofed name can't influence the path.
const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const DOCUMENT_TYPES = {
  ...IMAGE_TYPES,
  'application/pdf': '.pdf',
};

function makeFilter(typeMap) {
  const allowedExts = new Set([...Object.values(typeMap), '.jpeg']);
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimeOk = Object.prototype.hasOwnProperty.call(typeMap, file.mimetype);
    if (mimeOk && allowedExts.has(ext)) return cb(null, true);
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname);
    err.message = `Unsupported file type. Allowed: ${Object.keys(typeMap).join(', ')}.`;
    return cb(err);
  };
}

function makeFilename(typeMap) {
  return (_req, file, cb) => {
    const ext = typeMap[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '';
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  };
}

// ─── Profile / avatar images ───────────────────────────────────────────────
const avatarUpload = multer({
  storage: multer.diskStorage({ destination: AVATARS_DIR, filename: makeFilename(IMAGE_TYPES) }),
  fileFilter: makeFilter(IMAGE_TYPES),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// ─── Right-to-Work proof documents ──────────────────────────────────────────
const shareCodeUpload = multer({
  storage: multer.diskStorage({ destination: RTW_DIR, filename: makeFilename(DOCUMENT_TYPES) }),
  fileFilter: makeFilter(DOCUMENT_TYPES),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

module.exports = { avatarUpload, shareCodeUpload };
