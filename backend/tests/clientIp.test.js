const { clientIpFor } = require('../src/lib/clientIp');

const req = (headers, ip = '203.0.113.5') => ({ headers, ip, socket: {} });

describe('clientIpFor', () => {
  const SECRET = 'unit-test-secret-0123456789abcdef0123';
  afterEach(() => { delete process.env.WEB_PROXY_SECRET; });

  test('uses the address Express trusted (right-most hop), not the header', () => {
    expect(clientIpFor(req({ 'x-shiftgo-client-ip': '1.2.3.4' }))).toBe('203.0.113.5');
  });

  test('believes the web proxy header only with the matching secret', () => {
    process.env.WEB_PROXY_SECRET = SECRET;
    expect(clientIpFor(req({ 'x-shiftgo-client-ip': '1.2.3.4', 'x-shiftgo-proxy-secret': SECRET }))).toBe('1.2.3.4');
    expect(clientIpFor(req({ 'x-shiftgo-client-ip': '1.2.3.4', 'x-shiftgo-proxy-secret': 'wrong' }))).toBe('203.0.113.5');
  });

  test('a configured secret with no header sent, or a non-IP value, falls back', () => {
    process.env.WEB_PROXY_SECRET = SECRET;
    expect(clientIpFor(req({ 'x-shiftgo-client-ip': '1.2.3.4' }))).toBe('203.0.113.5');
    expect(clientIpFor(req({ 'x-shiftgo-client-ip': 'not an ip', 'x-shiftgo-proxy-secret': SECRET }))).toBe('203.0.113.5');
  });

  test('with no secret configured the header is never believed', () => {
    expect(clientIpFor(req({ 'x-shiftgo-client-ip': '1.2.3.4', 'x-shiftgo-proxy-secret': '' }))).toBe('203.0.113.5');
  });
});
