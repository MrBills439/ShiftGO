/**
 * One-shot location capture for an attendance action (clock in / clock out).
 *
 * Never throws. Returns a discriminated result so the caller can show the RIGHT
 * message: permission denied vs. location services off vs. weak GPS vs. timeout.
 * The app never fabricates coordinates and never decides "inside" — it just
 * reports what the device gave it (or why it couldn't).
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { ATTENDANCE } from './attendanceConfig';

export type CaptureFailure =
  | 'PERMISSION_DENIED'
  | 'SERVICES_DISABLED'
  | 'GPS_UNAVAILABLE'
  | 'TIMEOUT';

export type CapturedLocation = {
  ok: true;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
  mockLocationSuspected: boolean;
  /** true when accuracy is present but worse than the usable threshold. */
  lowAccuracy: boolean;
};

export type CaptureResult = CapturedLocation | { ok: false; reason: CaptureFailure };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('__timeout__')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Request (not just check) foreground permission and capture a fresh fix. */
export async function captureAttendanceLocation(): Promise<CaptureResult> {
  try {
    const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
    if (!enabled) return { ok: false, reason: 'SERVICES_DISABLED' };

    const perm = await Location.getForegroundPermissionsAsync();
    let status = perm.status;
    if (status !== 'granted' && perm.canAskAgain) {
      status = (await Location.requestForegroundPermissionsAsync()).status;
    }
    if (status !== 'granted') return { ok: false, reason: 'PERMISSION_DENIED' };

    const loc = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: ATTENDANCE.captureAccuracy }),
      ATTENDANCE.captureTimeoutMs,
    );

    const accuracy = typeof loc.coords.accuracy === 'number' ? loc.coords.accuracy : null;
    return {
      ok: true,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy,
      capturedAt: new Date(loc.timestamp || Date.now()).toISOString(),
      // `mocked` is Android-only and reasonably reliable there; undefined elsewhere.
      mockLocationSuspected: Platform.OS === 'android' && (loc as { mocked?: boolean }).mocked === true,
      lowAccuracy: accuracy != null && accuracy > ATTENDANCE.minUsableAccuracyM,
    };
  } catch (err) {
    if ((err as Error)?.message === '__timeout__') return { ok: false, reason: 'TIMEOUT' };
    return { ok: false, reason: 'GPS_UNAVAILABLE' };
  }
}

/** Passive capture (does not prompt) — used by the offline queue / background retries. */
export async function captureLocationIfPermitted(): Promise<
  Pick<CapturedLocation, 'latitude' | 'longitude' | 'accuracy' | 'capturedAt' | 'mockLocationSuspected'> | null
> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: ATTENDANCE.captureAccuracy }),
      ATTENDANCE.captureTimeoutMs,
    );
    return {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: typeof loc.coords.accuracy === 'number' ? loc.coords.accuracy : null,
      capturedAt: new Date(loc.timestamp || Date.now()).toISOString(),
      mockLocationSuspected: Platform.OS === 'android' && (loc as { mocked?: boolean }).mocked === true,
    };
  } catch {
    return null;
  }
}

export const CAPTURE_FAILURE_MESSAGE: Record<CaptureFailure, string> = {
  PERMISSION_DENIED: 'Location permission is off. Enable it in Settings to clock in.',
  SERVICES_DISABLED: 'Location services are turned off on your device. Turn them on to clock in.',
  GPS_UNAVAILABLE: "We couldn't get a GPS fix. Move to open sky and try again.",
  TIMEOUT: 'Getting your location is taking too long. Try again in the open.',
};
