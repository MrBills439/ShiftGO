import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const CLIENT_IP_HEADER = 'x-shiftgo-client-ip';
const PROXY_SECRET_HEADER = 'x-shiftgo-proxy-secret';

/**
 * The browser's IP as seen by the load balancer(s) in front of this web app.
 * X-Forwarded-For is read from the RIGHT: the left-most entries are whatever
 * the browser sent and can't be trusted. TRUSTED_PROXY_HOPS = how many load
 * balancers sit in front of the web app (default 1).
 */
function browserIp(request: NextRequest): string | null {
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10);
  const list = (request.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!Number.isInteger(hops) || hops < 1 || list.length < hops) return null;
  return list[list.length - hops] ?? null;
}

/**
 * /api/*  -> forwarded to the backend (next.config.mjs). Pass on the browser's
 *            real IP with the shared WEB_PROXY_SECRET so the backend's sign-in
 *            limits count per person, not per web server. Anything the browser
 *            sent in these headers is always replaced or removed.
 * pages   -> fast redirect to /sign-in when there is no session cookie at all
 *            (the API checks the session is valid on every request).
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const headers = new Headers(request.headers);
    headers.delete(CLIENT_IP_HEADER);
    headers.delete(PROXY_SECRET_HEADER);
    const secret = process.env.WEB_PROXY_SECRET;
    const ip = browserIp(request);
    if (secret && ip) {
      headers.set(CLIENT_IP_HEADER, ip);
      headers.set(PROXY_SECRET_HEADER, secret);
    }
    return NextResponse.next({ request: { headers } });
  }

  if (!getSessionCookie(request, { cookiePrefix: 'shiftgo' })) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!api|_next|sign-in|forgot-password|accept-invite|favicon|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
