/**
 * Upload content validation.
 *
 * This is *file-type* validation, not malware detection. It defends against a
 * file whose name / extension / declared MIME type lie about what it is
 * (e.g. `malware.exe` renamed to `passport.pdf` and sent as
 * `application/pdf`). It does NOT tell you a genuine PDF is safe — see
 * lib/malwareScan.js for where an antivirus engine plugs in.
 *
 * Right-to-Work: NEW uploads are PDF only. Existing stored documents in other
 * formats are untouched and still downloadable — nothing here runs on read.
 */
const fs = require('fs');
const path = require('path');

// "%PDF-" — the PDF header. The spec puts it at byte 0; every mainstream PDF
// producer (incl. the gov.uk share-code export) does too, so we require it
// exactly at offset 0 rather than scanning, which would let a polyglot through.
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

// Defence-in-depth ceiling. multer already enforces its own limit; this guards
// against that config drifting and gives a consistent error shape.
const RTW_MAX_BYTES = 10 * 1024 * 1024;

function httpError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/** Read the first `n` bytes of a file without loading the whole thing. */
function readHead(absPath, n) {
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(n);
    const read = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/** True iff the bytes on disk begin with the PDF header. Inspects actual bytes,
 *  never the filename or the client-declared type. */
function hasPdfSignature(absPath) {
  try {
    return readHead(absPath, PDF_MAGIC.length).equals(PDF_MAGIC);
  } catch {
    return false;
  }
}

/**
 * Validate an uploaded Right-to-Work document (multer file object). Throws an
 * error carrying { statusCode, code } on the first failure; returns nothing on
 * success. The caller is responsible for deleting the rejected file.
 *
 * Checks, in order: extension, declared MIME type, size, real magic bytes.
 */
function validateRtwUpload(file) {
  if (!file || !file.path) {
    throw httpError('No document uploaded. Upload a PDF.', 400, 'NO_FILE');
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext !== '.pdf') {
    throw httpError('Right-to-Work documents must be a PDF (.pdf).', 415, 'INVALID_EXTENSION');
  }

  if (file.mimetype !== 'application/pdf') {
    throw httpError('Right-to-Work documents must be a PDF (application/pdf).', 415, 'INVALID_MIME_TYPE');
  }

  const size = typeof file.size === 'number' ? file.size : fs.statSync(file.path).size;
  if (size <= 0) {
    throw httpError('The uploaded file is empty.', 400, 'EMPTY_FILE');
  }
  if (size > RTW_MAX_BYTES) {
    throw httpError('The document is too large. Maximum size is 10 MB.', 413, 'FILE_TOO_LARGE');
  }

  if (!hasPdfSignature(file.path)) {
    throw httpError(
      'That file is not a valid PDF. Upload the PDF of your Right-to-Work check.',
      415,
      'INVALID_FILE_SIGNATURE',
    );
  }
}

module.exports = { validateRtwUpload, hasPdfSignature, RTW_MAX_BYTES, PDF_MAGIC };
