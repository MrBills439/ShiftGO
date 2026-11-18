// Week 2: 5xx errors reach Sentry, and reports carry no personal data.
// Uses a local HTTP server as the Sentry ingest endpoint.
process.env.NODE_ENV = 'test';
const http = require('http');
const zlib = require('zlib');

let server;
const envelopes = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') body = zlib.gunzipSync(body);
      envelopes.push(body.toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${server.address().port}/1`;
});

afterAll(async () => {
  delete process.env.SENTRY_DSN;
  await new Promise((r) => server.close(r));
});

test('a 500 is reported without the body, headers, query string or email', async () => {
  const monitoring = require('../src/lib/monitoring');
  expect(monitoring.initMonitoring()).toBe(true);

  const express = require('express');
  const request = require('supertest');
  const errorHandler = require('../src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.post('/boom', (req, _res, next) => {
    req.user = { id: 'user_123', agencyId: 'agency_9', email: 'resident.family@example.com' };
    next(new Error('database exploded'));
  });
  app.post('/client-error', (_req, _res, next) => {
    const e = new Error('bad input'); e.statusCode = 404; next(e);
  });
  app.use(errorHandler);

  const res = await request(app)
    .post('/boom?nhsNumber=9434765919')
    .set('Authorization', 'Bearer secret-token-abc')
    .send({ residentName: 'Mary Smith', dob: '1940-01-01' });
  expect(res.status).toBe(500);
  await request(app).post('/client-error').send({});
  await monitoring.flushMonitoring(3000);

  const all = envelopes.join('\n');
  expect(all).toContain('database exploded');
  expect(all).toContain('user_123');
  expect(all).toContain('agency_9');
  for (const secret of ['Mary Smith', '1940-01-01', 'secret-token-abc', '9434765919', 'resident.family@example.com']) {
    expect(all).not.toContain(secret);
  }
  expect(all).not.toContain('bad input'); // 4xx are not reported
});
