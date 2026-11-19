/**
 * The browser only ever talks to this origin. Every /api/* request is
 * proxied to the ShiftGO API, including sign-in (/api/auth/* -> /auth/*), so
 * the session cookie is first-party: no cross-site cookies, no CORS, and the
 * cookie is never readable by page scripts (HttpOnly).
 *
 * API_PROXY_TARGET: the backend's URL as reachable from the Next.js server,
 * e.g. https://api.example.com (server-side only, not exposed). It is fixed at
 * BUILD time (Next.js bakes rewrites into the build), so pass it as a Docker
 * build argument; see web/Dockerfile.
 */
const API = (process.env.API_PROXY_TARGET || 'http://localhost:4000').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server in .next/standalone for the Docker image.
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/:path*` }];
  },
};

export default nextConfig;
