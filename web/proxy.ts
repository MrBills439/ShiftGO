import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * Fast redirect to /sign-in when there is no session cookie at all.
 * This only checks the cookie exists — the API checks it is valid on every request.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request, { cookiePrefix: 'shiftgo' })) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next|sign-in|forgot-password|accept-invite|favicon|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
