/**
 * End-to-end sign-in tests against a REAL Better Auth instance and the test
 * database (Better Auth is an ES module, so this runs on node --test, not Jest).
 *   npm run test:auth        (uses .env.test like the Jest suite)
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Test environment — same throwaway database as Jest.
const envTest = path.resolve(__dirname, '..', '.env.test');
if (fs.existsSync(envTest)) {
  for (const [k, v] of Object.entries(require('dotenv').parse(fs.readFileSync(envTest)))) process.env[k] = v;
}
if (!/(_test|test_|\btest\b)/i.test(process.env.DATABASE_URL || '')) throw new Error('Refusing: DATABASE_URL is not a test database');
Object.assign(process.env, {
  NODE_ENV: 'test', SHIFTGO_EMAIL_CAPTURE: 'true', RATE_LIMIT_DISABLED: 'true',
  CORS_ORIGINS: 'http://localhost:3000', WEB_APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'test-only-secret-for-node-test-0123456789abcdef',
});

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');
const { outbox } = require('../src/lib/email');

const ORIGIN = 'http://localhost:3000';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
let agency;
let ipCounter = 0;

/** A browser-like client: keeps cookies, sends Origin, and its own IP so
 *  Better Auth's per-IP sign-in limits don't leak between tests. */
function client() {
  const agent = request.agent(app);
  const ip = `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const wrap = (m) => (url) => agent[m](url).set('Origin', ORIGIN).set('X-Forwarded-For', ip);
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch') };
}

const tokenFrom = (to) => {
  const mail = [...outbox].reverse().find((m) => m.to === to && /accept-invite/.test(m.text));
  return decodeURIComponent(/accept-invite\?token=([^\s"&]+)/.exec(mail.text)[1]);
};
const codeFrom = (to) => /\b(\d{6})\b/.exec([...outbox].reverse().find((m) => m.to === to && /reset/i.test(m.subject)).text)[1];

/** RFC 6238 TOTP from an otpauth:// URI (what an authenticator app does). */
function totp(uri, offsetSteps = 0) {
  const secret = new URL(uri).searchParams.get('secret').replace(/=+$/, '').toUpperCase();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

/** HR invites (directly via the staging table, as createAgency.js does) and the person accepts. */
async function invitedAndAccepted(role, tag, password = 'correct horse battery staple') {
  const email = `auth-${tag}-${suffix}@shiftgo.test`;
  const pending = await prisma.pendingEmployee.create({
    data: { agencyId: agency.id, email, name: `Auth ${tag}`, role, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  await require('../src/services/invitationService').sendInvitation(pending.id);
  const res = await client().post('/invitations/accept').send({ token: tokenFrom(email), password });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { email, password };
}

async function signIn(c, email, password) {
  return c.post('/auth/sign-in/email').send({ email, password });
}

before(async () => {
  agency = await prisma.agency.create({ data: { name: `Auth Agency ${suffix}` } });
});

after(async () => {
  const users = await prisma.user.findMany({ where: { agencyId: agency.id }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.account.deleteMany({ where: { userId: { in: ids } } });
  await prisma.twoFactor.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { agencyId: agency.id } });
  await prisma.pendingEmployee.deleteMany({ where: { agencyId: agency.id } });
  await prisma.user.deleteMany({ where: { agencyId: agency.id } });
  await prisma.agency.delete({ where: { id: agency.id } });
  await prisma.verification.deleteMany({ where: { identifier: { contains: suffix } } });
  await prisma.$disconnect();
});

describe('invitation → password → session', () => {
  test('an invited worker sets a password, signs in, and the API knows who they are', async () => {
    const { email, password } = await invitedAndAccepted('WORKER', 'w1');
    const c = client();
    const res = await signIn(c, email, password);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.headers['set-cookie'].some((v) => v.startsWith('shiftgo.session_token=')));
    assert.ok(res.headers['set-cookie'].some((v) => /HttpOnly/i.test(v)));

    const me = await c.get('/users/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, email);
    assert.equal(me.body.data.role, 'WORKER');
    assert.equal(me.body.data.agencyId, agency.id);
    assert.equal(me.body.data.passwordHash, undefined);
  });

  test('no session → 401; a wrong password → refused', async () => {
    const { email } = await invitedAndAccepted('WORKER', 'w2');
    assert.equal((await client().get('/users/me')).status, 401);
    const bad = await signIn(client(), email, 'not the password at all');
    assert.equal(bad.status, 401);
  });

  test('there is no public sign-up', async () => {
    const res = await client().post('/auth/sign-up/email').send({ email: `intruder-${suffix}@x.test`, password: 'a long enough password', name: 'X' });
    assert.ok(res.status >= 400, `sign-up should be refused, got ${res.status}`);
    assert.equal(await prisma.user.count({ where: { email: `intruder-${suffix}@x.test` } }), 0);
  });

  test('signing out ends the session', async () => {
    const { email, password } = await invitedAndAccepted('WORKER', 'w3');
    const c = client();
    await signIn(c, email, password);
    assert.equal((await c.get('/users/me')).status, 200);
    await c.post('/auth/sign-out').send({});
    assert.equal((await c.get('/users/me')).status, 401);
  });
});

describe('forgot password (email code)', () => {
  test('a reset code works once, changes the password and signs out other devices', async () => {
    const { email, password } = await invitedAndAccepted('WORKER', 'reset');
    const phone = client();
    await signIn(phone, email, password);
    assert.equal((await phone.get('/users/me')).status, 200);

    const web = client();
    const sent = await web.post('/auth/email-otp/send-verification-otp').send({ email, type: 'forget-password' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const otp = codeFrom(email);
    const reset = await web.post('/auth/email-otp/reset-password').send({ email, otp, password: 'a brand new long password' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));

    assert.equal((await phone.get('/users/me')).status, 401, 'the old session must be revoked');
    assert.equal((await signIn(client(), email, password)).status, 401, 'old password no longer works');
    assert.equal((await signIn(client(), email, 'a brand new long password')).status, 200);
    const replay = await client().post('/auth/email-otp/reset-password').send({ email, otp, password: 'yet another long password' });
    assert.ok(replay.status >= 400, 'a code cannot be reused');
  });

  test('an email code can never be used to SIGN IN (it would skip two-step verification)', async () => {
    const { email } = await invitedAndAccepted('WORKER', 'otpsignin');
    const ask = await client().post('/auth/email-otp/send-verification-otp').send({ email, type: 'sign-in' });
    assert.equal(ask.status, 403);
    const res = await client().post('/auth/sign-in/email-otp').send({ email, otp: '123456' });
    assert.equal(res.status, 403);
  });
});

describe('deactivation', () => {
  test('a deactivated person is signed out at once and cannot sign in again', async () => {
    const { email, password } = await invitedAndAccepted('WORKER', 'leaver');
    const c = client();
    await signIn(c, email, password);
    assert.equal((await c.get('/users/me')).status, 200);

    // what POST /users/:id/deactivate does (covered in Jest): status + delete sessions
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED', deactivatedAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    assert.equal((await c.get('/users/me')).status, 401);
    const again = await signIn(client(), email, password);
    assert.equal(again.status, 403, JSON.stringify(again.body));
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
  });
});

describe('two-step verification for HR and managers', () => {
  test('HR must enable it before using the API; afterwards sign-in needs the authenticator code', async () => {
    process.env.REQUIRE_2FA_FOR_ADMINS = 'true';
    const config = require('../src/config');
    config.auth.require2faForAdmins = true;
    const { email, password } = await invitedAndAccepted('HR', 'hr2fa');
    const c = client();
    assert.equal((await signIn(c, email, password)).status, 200);

    assert.equal((await c.get('/users/me')).status, 200, 'profile is allowed so the app can show the setup screen');
    const blocked = await c.get('/users');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'TWO_FACTOR_REQUIRED');

    const enable = await c.post('/auth/two-factor/enable').send({ password });
    assert.equal(enable.status, 200, JSON.stringify(enable.body));
    assert.match(enable.body.totpURI, /^otpauth:\/\/totp\//);
    assert.ok(Array.isArray(enable.body.backupCodes) && enable.body.backupCodes.length >= 5);
    const verify = await c.post('/auth/two-factor/verify-totp').send({ code: totp(enable.body.totpURI) });
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    assert.equal((await prisma.user.findUnique({ where: { email } })).twoFactorEnabled, true);
    assert.equal((await c.get('/users')).status, 200, 'unlocked once 2FA is on');

    // a fresh sign-in now stops at the second step
    const c2 = client();
    const first = await signIn(c2, email, password);
    assert.equal(first.status, 200);
    assert.equal(first.body.twoFactorRedirect, true);
    assert.equal((await c2.get('/users/me')).status, 401, 'no session until the code is entered');
    const wrong = await c2.post('/auth/two-factor/verify-totp').send({ code: '000000' });
    assert.ok(wrong.status >= 400);
    const second = await c2.post('/auth/two-factor/verify-totp').send({ code: totp(enable.body.totpURI) });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal((await c2.get('/users')).status, 200);

    config.auth.require2faForAdmins = false;
  });

  test('workers are not required to use two-step verification', async () => {
    const config = require('../src/config');
    config.auth.require2faForAdmins = true;
    const { email, password } = await invitedAndAccepted('WORKER', 'no2fa');
    const c = client();
    await signIn(c, email, password);
    assert.equal((await c.get('/shifts')).status, 200);
    config.auth.require2faForAdmins = false;
  });
});

describe('brute force', () => {
  test('repeated wrong passwords from one address are rate-limited', async () => {
    const { email } = await invitedAndAccepted('WORKER', 'brute');
    const c = client();
    const statuses = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await signIn(c, email, `wrong password ${i}`)).status);
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
  });

  // An attacker cannot pick a fresh "IP" per guess: only the address our own
  // load balancer appended (the right-most entry) counts.
  test('a made-up X-Forwarded-For does not get around the limit', async () => {
    const { email } = await invitedAndAccepted('WORKER', 'spoof');
    const statuses = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await request(app).post('/auth/sign-in/email')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', `198.51.100.${i + 1}, 203.0.113.77`)
        .send({ email, password: `wrong password ${i}` });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
  });

  test("the web app's server can pass on each browser's IP, but only with the shared secret", async () => {
    const { email } = await invitedAndAccepted('WORKER', 'webproxy');
    const prev = process.env.WEB_PROXY_SECRET;
    process.env.WEB_PROXY_SECRET = 'test-web-proxy-secret-0123456789abcdef';
    try {
      const viaWeb = (browserIp, secret) => request(app).post('/auth/sign-in/email')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', '203.0.113.88') // the web server
        .set('X-ShiftGO-Client-IP', browserIp)
        .set('X-ShiftGO-Proxy-Secret', secret)
        .send({ email, password: 'wrong password here' });

      // Seven different browsers behind the same web server: none is blocked.
      const browsers = [];
      for (let i = 0; i < 7; i += 1) browsers.push((await viaWeb(`192.0.2.${i + 10}`, process.env.WEB_PROXY_SECRET)).status);
      assert.ok(!browsers.includes(429), `no browser should be limited: ${browsers.join(',')}`);

      // Without the right secret the header is ignored, so all of these count
      // against the sender's own address and are limited.
      const forged = [];
      for (let i = 0; i < 7; i += 1) forged.push((await viaWeb(`192.0.2.${i + 50}`, 'not-the-secret')).status);
      assert.ok(forged.includes(429), `forged headers should be limited: ${forged.join(',')}`);
    } finally {
      if (prev === undefined) delete process.env.WEB_PROXY_SECRET; else process.env.WEB_PROXY_SECRET = prev;
    }
  });
});
