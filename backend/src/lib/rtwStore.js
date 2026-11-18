/**
 * Where accepted Right-to-Work documents live.
 *
 * RTW_STORAGE_DRIVER=local (default) — files under UPLOAD_DIR/rtw on the server
 *   disk (the original behaviour). Fine for development; in production it means
 *   one Railway volume, no versioning, no encryption you control.
 *
 * RTW_STORAGE_DRIVER=s3 — any S3-compatible bucket (AWS S3, Cloudflare R2,
 *   Backblaze B2, ...). Every object is written with server-side encryption
 *   (S3_SSE, default AES256) and the bucket should have versioning +
 *   lifecycle/backup rules enabled (see docs/DOCUMENT_STORAGE.md).
 *
 * The database keeps the same `documentPath` format in both modes
 * ("/uploads/rtw/<name>"); the object key is "rtw/<name>". In s3 mode a read
 * whose object is not in the bucket yet falls back to the local file, so the
 * switch-over can happen before scripts/migrateRtwToS3.js has run.
 *
 * Upload validation is unchanged: multer still writes to the local quarantine
 * dir, the controller validates/scans it there, and only then calls
 * acceptFromQuarantine().
 */
const fs = require('fs');
const path = require('path');
const storage = require('./storage');

const PREFIX = '/uploads/rtw/';

function driver() {
  return (process.env.RTW_STORAGE_DRIVER || 'local').toLowerCase();
}

/** Basename of a stored RTW web path, or null if it is not a safe RTW path. */
function nameFromWebPath(webPath) {
  if (typeof webPath !== 'string' || !webPath.startsWith(PREFIX)) return null;
  const name = webPath.slice(PREFIX.length);
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  return name;
}

// ─── S3 ─────────────────────────────────────────────────────────────────────
let s3Client = null;
function s3() {
  if (!s3Client) {
    const { S3Client } = require('@aws-sdk/client-s3');
    const credentials = process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
      : undefined; // fall back to the SDK's standard AWS_* env / instance role
    s3Client = new S3Client({
      region: process.env.S3_REGION || 'eu-west-2',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials,
    });
  }
  return s3Client;
}

function bucket() {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error('RTW_STORAGE_DRIVER=s3 requires S3_BUCKET');
  return b;
}

function encryptionParams() {
  const sse = process.env.S3_SSE || 'AES256';
  if (sse === 'none') return {};
  const params = { ServerSideEncryption: sse };
  if (sse === 'aws:kms' && process.env.S3_SSE_KMS_KEY_ID) params.SSEKMSKeyId = process.env.S3_SSE_KMS_KEY_ID;
  return params;
}

const keyFor = (name) => `rtw/${name}`;

function contentTypeFor(name) {
  const ext = path.extname(name).toLowerCase();
  return { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext]
    || 'application/octet-stream';
}

async function putObject(name, absPath) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { size } = await fs.promises.stat(absPath);
  await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: keyFor(name),
    Body: fs.createReadStream(absPath),
    ContentLength: size,
    ContentType: contentTypeFor(name),
    ...encryptionParams(),
  }));
}

async function deleteObject(name) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: keyFor(name) }));
}

async function getObjectStream(name) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: keyFor(name) }));
    return out.Body;
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Move a validated upload out of quarantine into permanent storage.
 * @returns {Promise<{ webPath: string, name: string, discard: () => Promise<void> }>}
 *          `discard` undoes the store if the follow-up DB write fails.
 */
async function acceptFromQuarantine(quarantineAbsPath) {
  if (driver() === 's3') {
    const src = path.resolve(String(quarantineAbsPath || ''));
    if (!storage.isInsideDir(storage.RTW_QUARANTINE_DIR, src)) {
      throw new Error('acceptFromQuarantine: source is not inside the quarantine directory');
    }
    const name = path.basename(src);
    await putObject(name, src);
    await storage.unlinkInside(storage.RTW_QUARANTINE_DIR, src);
    return { webPath: `${PREFIX}${name}`, name, discard: () => deleteObject(name).catch(() => {}) };
  }
  const promoted = await storage.promoteRtwUpload(quarantineAbsPath);
  return {
    webPath: promoted.webPath,
    name: path.basename(promoted.acceptedAbsPath),
    discard: async () => { await storage.unlinkInside(storage.RTW_DIR, promoted.acceptedAbsPath); },
  };
}

function localStream(webPath) {
  const abs = storage.resolveStoredPath(webPath);
  if (!abs || !storage.isInsideDir(storage.RTW_DIR, abs) || !fs.existsSync(abs)) return null;
  return fs.createReadStream(abs);
}

/** Readable stream of a stored document, or null if it does not exist. */
async function open(webPath) {
  const name = nameFromWebPath(webPath);
  if (!name) return null;
  if (driver() === 's3') {
    const body = await getObjectStream(name);
    if (body) return body;
    return localStream(webPath); // not migrated yet
  }
  return localStream(webPath);
}

/** Best-effort delete of a stored document (both places in s3 mode). Never throws. */
async function remove(webPath) {
  const name = nameFromWebPath(webPath);
  if (!name) return;
  if (driver() === 's3') await deleteObject(name).catch(() => {});
  const abs = storage.resolveStoredPath(webPath);
  if (abs) await storage.unlinkInside(storage.RTW_DIR, abs);
}

/** For tests: drop the cached client so env changes take effect. */
function _resetClient() {
  s3Client = null;
}

module.exports = {
  driver, acceptFromQuarantine, open, remove, nameFromWebPath, contentTypeFor,
  putObject, _resetClient, PREFIX,
};
