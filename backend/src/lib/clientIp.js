/**
 * The real client IP, for rate limiting and audit logs.
 *
 * Never trust X-Forwarded-For as sent: the first entry is whatever the caller
 * typed, so keying a brute-force limit on it lets an attacker pick a new
 * "IP" for every guess. Instead:
 *
 *  - Direct callers (the mobile app, curl): Express's `trust proxy` hop count
 *    (TRUST_PROXY_HOPS, default 1 = one load balancer in front of the API)
 *    reads X-Forwarded-For from the RIGHT, i.e. the address our own load
 *    balancer saw.
 *  - The web app's server (Next.js forwards /api/*): every browser request
 *    would otherwise look like it came from the web server. It sends the
 *    browser's IP in X-ShiftGO-Client-IP together with a shared secret
 *    (WEB_PROXY_SECRET). The header is only believed when the secret matches.
 *
 * resolveClientIp() then OVERWRITES X-ShiftGO-Client-IP with the result, which
 * is the only header Better Auth reads for its limits (src/auth/index.js).
 */
const crypto = require('crypto');
const net = require('net');

const CLIENT_IP_HEADER = 'x-shiftgo-client-ip';
const PROXY_SECRET_HEADER = 'x-shiftgo-proxy-secret';

function trustProxyHops() {
  const n = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

function secretMatches(sent) {
  const expected = process.env.WEB_PROXY_SECRET || '';
  if (!expected || typeof sent !== 'string' || !sent) return false;
  const a = crypto.createHash('sha256').update(sent).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function clientIpFor(req) {
  const fromWeb = req.headers[CLIENT_IP_HEADER];
  if (typeof fromWeb === 'string' && net.isIP(fromWeb.trim()) && secretMatches(req.headers[PROXY_SECRET_HEADER])) {
    return fromWeb.trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

function resolveClientIp(req, _res, next) {
  const ip = clientIpFor(req);
  req.clientIp = ip;
  req.headers[CLIENT_IP_HEADER] = ip;
  delete req.headers[PROXY_SECRET_HEADER];
  next();
}

module.exports = { resolveClientIp, clientIpFor, trustProxyHops, CLIENT_IP_HEADER, PROXY_SECRET_HEADER };
