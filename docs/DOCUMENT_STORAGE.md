# Right-to-Work document storage

Right-to-Work (RTW) proof documents contain passport and visa details. By
default they are stored on the API server's disk (`UPLOAD_DIR/rtw`, a single
Railway volume): no versioning, no backups, and no encryption you control.
For production, store them in an S3-compatible bucket instead.

## 1. Create the bucket

Any S3-compatible provider works (AWS S3, Cloudflare R2, Backblaze B2).
Prefer a UK/EU region for UK GDPR.

Bucket settings:
- **Block all public access.** Documents are only ever served through the
  authenticated `/right-to-work` API, never by direct URL.
- **Versioning on.** An overwritten or deleted document can be recovered.
- **Default encryption on** (SSE-S3 / AES-256, or SSE-KMS). The app also
  requests encryption on every upload (`S3_SSE`).
- **Lifecycle rule:** delete non-current versions after e.g. 90 days, so
  deleted documents do not live forever (RTW copies should be kept for the
  employment plus 2 years, then deleted).
- **Backups:** turn on replication to a second region or bucket, or your
  provider's backup feature.

Create an access key that can only `s3:PutObject`, `s3:GetObject`,
`s3:DeleteObject` and `s3:ListBucket` on this one bucket.

## 2. Configure the API

Set on the backend service (Railway → Variables):

| Variable | Example | Notes |
|---|---|---|
| `RTW_STORAGE_DRIVER` | `s3` | `local` (default) or `s3` |
| `S3_BUCKET` | `shiftgo-rtw-prod` | required when the driver is `s3` |
| `S3_REGION` | `eu-west-2` | R2: `auto` |
| `S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | leave unset for AWS S3 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | | the restricted key from step 1 |
| `S3_SSE` | `AES256` | `aws:kms` (+ `S3_SSE_KMS_KEY_ID`), or `none` if your provider rejects the header (R2 always encrypts at rest) |
| `S3_FORCE_PATH_STYLE` | `false` | `true` for MinIO-style endpoints |

The API refuses to start with `RTW_STORAGE_DRIVER=s3` and no `S3_BUCKET`.

## 3. Move the existing documents

After deploying with the new variables, downloads still work: a document not
yet in the bucket is read from the local disk. Then, from a shell with the same
environment (e.g. `railway run`):

```bash
node scripts/migrateRtwToS3.js                  # dry run: shows what it would copy
node scripts/migrateRtwToS3.js --apply          # copy to the bucket
node scripts/migrateRtwToS3.js --apply --delete-local   # once verified: remove local copies
```

It is safe to re-run; anything already in the bucket is skipped. The database
is not changed. Each local copy is deleted only after its object is confirmed
in the bucket.

## How it works

- Uploads are still validated on local disk first (`_quarantine/`, PDF
  signature check, malware-scan seam), then stored via `src/lib/rtwStore.js`.
- Downloads stream from the bucket through the API with
  `Cache-Control: private, no-store`; every download is audit-logged.
- Tests: `backend/tests/rtwS3Storage.test.js` runs the whole flow against a
  local S3 emulator (`moto`); CI starts one automatically.
