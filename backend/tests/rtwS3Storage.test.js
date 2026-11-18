// Week 2: Right-to-Work documents in an S3-compatible bucket, encrypted at rest.
//
// Runs against a real S3 API. Locally:  pip install "moto[server]" &&
//   moto_server -p 5055   then   S3_TEST_ENDPOINT=http://127.0.0.1:5055 npm test
// CI starts moto the same way. Skipped when S3_TEST_ENDPOINT is not set.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-access-secret';
process.env.RATE_LIMIT_DISABLED = 'true';

const ENDPOINT = process.env.S3_TEST_ENDPOINT;
const describeS3 = ENDPOINT ? describe : describe.skip;

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PDF_1 = Buffer.from('%PDF-1.4\nfirst document\n%%EOF\n', 'latin1');
const PDF_2 = Buffer.from('%PDF-1.4\nsecond document\n%%EOF\n', 'latin1');
const BUCKET = `shiftgo-rtw-test-${Date.now()}`;

describeS3('Right-to-Work documents in S3', () => {
  let app; let storage; let rtwStore; let s3; let cmd; let tokenFor;
  let agency; let hr; let worker;

  const objectKeys = async () => {
    const out = await s3.send(new cmd.ListObjectsV2Command({ Bucket: BUCKET }));
    return (out.Contents || []).map((o) => o.Key);
  };
  const upload = (bytes) => request(app).post('/right-to-work/me/document')
    .set('Authorization', `Bearer ${tokenFor(worker)}`)
    .attach('document', bytes, { filename: 'passport.pdf', contentType: 'application/pdf' });
  const download = () => request(app).get(`/right-to-work/user/${worker.id}/document`)
    .set('Authorization', `Bearer ${tokenFor(hr)}`)
    .buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

  beforeAll(async () => {
    Object.assign(process.env, {
      RTW_STORAGE_DRIVER: 's3', S3_BUCKET: BUCKET, S3_ENDPOINT: ENDPOINT, S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: 'true', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test', S3_SSE: 'AES256',
    });
    cmd = require('@aws-sdk/client-s3');
    s3 = new cmd.S3Client({ region: 'us-east-1', endpoint: ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
    await s3.send(new cmd.CreateBucketCommand({ Bucket: BUCKET }));

    app = require('../src/app');
    storage = require('../src/lib/storage');
    rtwStore = require('../src/lib/rtwStore');
    rtwStore._resetClient();
    ({ signAccess: tokenFor } = { signAccess: (u) => require('../src/utils/jwt').signAccess({ id: u.id, agencyId: u.agencyId, role: u.role }) });

    agency = await prisma.agency.create({ data: { name: `RTW S3 ${suffix}` } });
    hr = await prisma.user.create({ data: { agencyId: agency.id, role: 'HR', name: 'S3 HR', email: `s3-hr-${suffix}@shiftgo.test` } });
    worker = await prisma.user.create({ data: { agencyId: agency.id, role: 'WORKER', name: 'S3 Worker', email: `s3-w-${suffix}@shiftgo.test` } });
    await prisma.shareCode.create({ data: { agencyId: agency.id, userId: worker.id, code: 'S3T3ST001', shareDate: new Date() } });
  });

  afterAll(async () => {
    delete process.env.RTW_STORAGE_DRIVER;
    await prisma.shareCode.deleteMany({ where: { agencyId: agency.id } });
    await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
    await prisma.user.deleteMany({ where: { agencyId: agency.id } });
    await prisma.agency.delete({ where: { id: agency.id } });
    await prisma.$disconnect();
  });

  test('upload goes to the bucket, encrypted, and nothing stays on local disk', async () => {
    const res = await upload(PDF_1);
    expect(res.status).toBe(200);
    const keys = await objectKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^rtw\/[a-f0-9]{32}\.pdf$/);

    const head = await s3.send(new cmd.HeadObjectCommand({ Bucket: BUCKET, Key: keys[0] }));
    expect(head.ServerSideEncryption).toBe('AES256');
    expect(head.ContentType).toBe('application/pdf');

    const name = keys[0].slice('rtw/'.length);
    expect(fs.existsSync(path.join(storage.RTW_DIR, name))).toBe(false);
    expect(fs.readdirSync(storage.RTW_QUARANTINE_DIR)).not.toContain(name);
  });

  test('download streams the exact bytes back from the bucket', async () => {
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.body, PDF_1)).toBe(0);
  });

  test('replacing the document deletes the old object', async () => {
    const [oldKey] = await objectKeys();
    expect((await upload(PDF_2)).status).toBe(200);
    // removal of the previous object is fire-and-forget; give it a moment
    await new Promise((r) => setTimeout(r, 300));
    const keys = await objectKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(oldKey);
    expect(Buffer.compare((await download()).body, PDF_2)).toBe(0);
  });

  test('bulk ZIP export reads documents from the bucket', async () => {
    const res = await request(app).get('/right-to-work/export')
      .set('Authorization', `Bearer ${tokenFor(hr)}`)
      .buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    // Unzip with the system's Python (always present on CI runners and here).
    const zipPath = path.join(require('os').tmpdir(), `rtw-export-${suffix}.zip`);
    fs.writeFileSync(zipPath, res.body);
    const script = 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);n=[x for x in z.namelist() if x.endswith(".pdf")];sys.stdout.buffer.write(z.read(n[0]))';
    const pdf = require('child_process').execFileSync('python3', ['-I', '-c', script, zipPath]);
    fs.unlinkSync(zipPath);
    expect(Buffer.compare(pdf, PDF_2)).toBe(0);
  });

  test('a legacy file still on local disk is served until it is migrated', async () => {
    const legacyName = `${'b'.repeat(32)}.pdf`;
    fs.writeFileSync(path.join(storage.RTW_DIR, legacyName), PDF_1);
    await prisma.shareCode.update({ where: { userId: worker.id }, data: { documentPath: `/uploads/rtw/${legacyName}`, documentName: 'old.pdf' } });
    const res = await download();
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, PDF_1)).toBe(0);
    fs.unlinkSync(path.join(storage.RTW_DIR, legacyName));
  });
});
