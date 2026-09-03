const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { AVATARS_DIR, RTW_DIR, ensureUploadDirs } = require('../lib/storage');

// multer.diskStorage does not create the destination directory itself, so make
// sure every upload directory exists before any request is handled. On a fresh
// Railway volume (UPLOAD_DIR=/app/uploads) these won't exist yet.
ensureUploadDirs();

const randomName = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
};

// ─── Profile / avatar images ───────────────────────────────────────────────
const storage = multer.diskStorage({ destination: AVATARS_DIR, filename: randomName });

const fileFilter = (_req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, allowed.includes(ext));
};

const avatarUpload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Right-to-Work proof documents ──────────────────────────────────────────
const rtwStorage = multer.diskStorage({ destination: RTW_DIR, filename: randomName });

const rtwFileFilter = (_req, file, cb) => {
  const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, allowed.includes(ext));
};

const shareCodeUpload = multer({
  storage: rtwStorage,
  fileFilter: rtwFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { avatarUpload, shareCodeUpload };
