/**
 * Client-side attendance / GPS tunables. Mirrors the safety-relevant subset of
 * the backend's `config/attendance.js`. The BACKEND is always the authority on
 * geofence decisions — these values only shape what the app captures and how
 * often it reports.
 */
import * as Location from 'expo-location';

export const ATTENDANCE = {
  /** Accuracy tier requested for the one-shot clock in/out fix. */
  captureAccuracy: Location.Accuracy.High as Location.Accuracy,
  /** Give up waiting for a fix after this long (ms) and report GPS_UNAVAILABLE. */
  captureTimeoutMs: 12_000,
  /** Never accept a cached OS fix for an attendance action — force a fresh read. */
  captureMaxAgeMs: 0,
  /** A fix worse than this (m) can't verify a geofence — surfaced to the user. */
  minUsableAccuracyM: 100,

  /** How often to report location to the backend while clocked in. The server
   *  echoes an authoritative `reportIntervalMs`; this is the startup default. */
  reportIntervalMs: 60_000,
  /** Background stream cadence / displacement. */
  backgroundTimeIntervalMs: 60_000,
  backgroundDistanceIntervalM: 25,

  /** Local cool-down between showing the same off-site prompt again, in case the
   *  server-side snooze and the app get briefly out of step. */
  promptCooldownMs: 5 * 60_000,
} as const;

/** AsyncStorage key holding `{ shiftId }` for the shift currently being monitored. */
export const MONITOR_STATE_KEY = 'shiftgo_attendance_monitor_v2';
