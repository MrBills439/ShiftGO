#!/usr/bin/env node
/**
 * Copy existing Right-to-Work documents from the server disk (UPLOAD_DIR/rtw)
 * into the S3 bucket configured for RTW_STORAGE_DRIVER=s3.
 *
 *   node scripts/migrateRtwToS3.js                 # dry run: report only
 *   node scripts/migrateRtwToS3.js --apply         # upload missing objects
 *   node scripts/migrateRtwToS3.js --apply --delete-local
 *        # ...and delete each local copy once its object is verified in S3
 *
 * Safe to re-run: objects already in the bucket are skipped. The database is
 * never changed — documentPath keeps the same "/uploads/rtw/<name>" value.
 * Needs the same env as the server (DATABASE_URL, S3_*).
 */
require('dotenv').config();
const fs = require('fs');

const apply = process.argv.includes('--apply');
const deleteLocal = process.argv.includes('--delete-local');

async function main() {
  if ((process.env.RTW_STORAGE_DRIVER || '').toLowerCase() !== 's3') {
    throw new Error('Set RTW_STORAGE_DRIVER=s3 and the S3_* variables first.');
  }
  const prisma = require('../src/lib/prisma');
  const storage = require('../src/lib/storage');
  const rtwStore = require('../src/lib/rtwStore');
  const { HeadObjectCommand, S3Client } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: process.env.S3_REGION || 'eu-west-2',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
      : undefined,
  });
  const inBucket = async (name) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: `rtw/${name}` }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  };

  const rows = await prisma.shareCode.findMany({ where: { documentPath: { not: null } }, select: { id: true, documentPath: true } });
  const totals = { documents: rows.length, uploaded: 0, alreadyInBucket: 0, missingLocally: 0, localDeleted: 0, failed: 0 };

  for (const row of rows) {
    const name = rtwStore.nameFromWebPath(row.documentPath);
    const abs = name && storage.resolveStoredPath(row.documentPath);
    try {
      if (!name) { totals.failed += 1; console.warn(`skip ${row.id}: unexpected path ${row.documentPath}`); continue; }
      const already = await inBucket(name);
      const local = abs && fs.existsSync(abs);
      if (already) totals.alreadyInBucket += 1;
      else if (!local) { totals.missingLocally += 1; console.warn(`MISSING ${row.id}: ${row.documentPath} is neither on disk nor in the bucket`); continue; }
      else if (apply) { await rtwStore.putObject(name, abs); totals.uploaded += 1; }
      else { console.log(`would upload ${row.documentPath}`); totals.uploaded += 1; }

      if (apply && deleteLocal && local && (await inBucket(name))) {
        await fs.promises.unlink(abs);
        totals.localDeleted += 1;
      }
    } catch (err) {
      totals.failed += 1;
      console.error(`FAILED ${row.id} (${row.documentPath}): ${err.message}`);
    }
  }

  console.log(`${apply ? 'Done' : 'Dry run (no changes — pass --apply)'}:`, JSON.stringify(totals));
  await prisma.$disconnect();
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
