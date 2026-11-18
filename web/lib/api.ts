import axios from 'axios';

/**
 * All API calls go to /api on this origin (proxied to the backend by
 * next.config.mjs), so the HttpOnly session cookie is sent automatically —
 * no tokens in JavaScript.
 */
export const API_BASE = '/api';

export const api = axios.create({ baseURL: API_BASE, timeout: 12000, withCredentials: true });

const PUBLIC_PATHS = ['/sign-in', '/forgot-password', '/accept-invite'];

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const onPublic = PUBLIC_PATHS.some((p) => window.location.pathname.startsWith(p));
      if (!onPublic) window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
    }
    return Promise.reject(error);
  }
);

/** Download a file from the API with the session cookie (same origin). */
export async function authedDownload(pathname: string, filename: string) {
  const res = await fetch(`${API_BASE}${pathname}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
