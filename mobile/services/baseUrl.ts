import Constants from 'expo-constants';

/**
 * API base URL.
 *
 * Release builds (EAS preview / production): EXPO_PUBLIC_API_URL MUST be provided
 * as an https:// URL — via `eas.json` (build.<profile>.env) or an EAS environment
 * variable. A release build with it missing/misconfigured throws immediately
 * rather than silently falling back to localhost and shipping a store build that
 * cannot reach the backend.
 *
 * Development: an explicit https:// URL still wins; otherwise the host is derived
 * from the Metro/Expo dev server that served this bundle (so a changing Mac LAN
 * IP needs no .env edit); otherwise the .env value; otherwise localhost.
 */
const isReleaseBuild = !__DEV__ && process.env.NODE_ENV !== 'test';

function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  const isHttps = !!explicit && /^https:\/\//i.test(explicit);

  if (isReleaseBuild) {
    if (isHttps) return explicit as string;
    throw new Error(
      '[API] EXPO_PUBLIC_API_URL is missing or is not an https:// URL in this release build. ' +
        'Set it in mobile/eas.json (build.<profile>.env) or as an EAS environment variable ' +
        'for the preview/production environment.',
    );
  }

  // ── development / test below ──
  if (isHttps) return explicit as string;

  // e.g. "192.168.0.36:8082" or "192.168.0.36:8082/..." — take the host only.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
    '';
  const host = hostUri.split('/')[0].split(':')[0];
  // Only reuse the Metro host when it's a LAN IPv4 literal. Under `--tunnel` the
  // Metro host is a public domain (e.g. *.exp.direct) that only forwards Metro,
  // not the API port — in that case fall through to the explicit URL.
  const isLanIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host !== '127.0.0.1';
  if (isLanIpv4) {
    return `http://${host}:4000`;
  }

  return explicit || 'http://localhost:4000';
}

const BASE_URL = resolveBaseUrl();
if (__DEV__) console.log('[API] base URL:', BASE_URL);

/** Resolved API origin — reuse this instead of re-reading EXPO_PUBLIC_API_URL,
 *  e.g. to build absolute URLs for server-served assets like /uploads/avatars. */
export const API_BASE_URL = BASE_URL;
