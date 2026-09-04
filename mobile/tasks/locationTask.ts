/**
 * Shift-aware background attendance monitoring.
 *
 * Lifecycle:
 *   clock-in success            -> startAttendanceMonitoring(shiftId)
 *   clock-out / logout / cancel -> stopAttendanceMonitoring()
 *   app launch / resume         -> reconcileMonitoring()  (kills zombies)
 *
 * The background task reports the current location to the backend, which owns
 * every geofence / exit / auto-clock-out decision. If the backend says the
 * attendance is no longer active, the task stops itself and cleans up.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportLocation, getAttendanceState } from '../services/clockService';
import { ATTENDANCE, MONITOR_STATE_KEY } from '../lib/attendanceConfig';

export const LOCATION_TASK = 'shiftgo-attendance-location';

// `expo-task-manager` is a native module absent from Expo Go — background
// monitoring simply no-ops there (foreground clock in/out still works).
export const backgroundLocationSupported =
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type MonitorState = { shiftId: string } | null;

async function readState(): Promise<MonitorState> {
  try {
    const raw = await AsyncStorage.getItem(MONITOR_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function writeState(state: MonitorState) {
  if (state) await AsyncStorage.setItem(MONITOR_STATE_KEY, JSON.stringify(state));
  else await AsyncStorage.removeItem(MONITOR_STATE_KEY);
}

async function updatesRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Report one reading for the monitored shift. Returns false if monitoring should stop. */
export async function reportOnce(coords: {
  latitude: number; longitude: number; accuracy: number | null; capturedAt?: string;
}): Promise<boolean> {
  const state = await readState();
  if (!state?.shiftId) return false;
  try {
    const res = await reportLocation(state.shiftId, coords);
    return res.active !== false;
  } catch (err: unknown) {
    // No response = offline / server down: keep monitoring, try again next tick.
    // Any concrete error response is treated as "stop" only when it says so.
    const resp = (err as { response?: { data?: { data?: { active?: boolean } } } })?.response;
    if (resp && resp.data?.data?.active === false) return false;
    return true;
  }
}

if (backgroundLocationSupported) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');

  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[AttendanceTask]', error.message);
      return;
    }
    const loc = (data as { locations?: Location.LocationObject[] })?.locations?.[0];
    if (!loc) return;

    const keepGoing = await reportOnce({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: typeof loc.coords.accuracy === 'number' ? loc.coords.accuracy : null,
      capturedAt: new Date(loc.timestamp || Date.now()).toISOString(),
    });
    if (!keepGoing) await stopAttendanceMonitoring();
  });
}

/** Begin monitoring for a specific clocked-in shift. Safe to call repeatedly. */
export async function startAttendanceMonitoring(shiftId: string): Promise<boolean> {
  await writeState({ shiftId });

  if (!backgroundLocationSupported) return false;

  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: 'denied' as const }));
  if (bg.status !== 'granted') {
    // Foreground reporting (via useClockStatus) still works; just no background.
    return false;
  }

  if (await updatesRunning()) return true;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: ATTENDANCE.backgroundTimeIntervalMs,
    distanceInterval: ATTENDANCE.backgroundDistanceIntervalM,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'ShiftGO — on shift',
      notificationBody: 'Confirming your attendance while you are clocked in.',
      notificationColor: '#005f55',
    },
  });
  return true;
}

/** Stop monitoring and clear all local state. Idempotent — never leaves a zombie task. */
export async function stopAttendanceMonitoring(): Promise<void> {
  await writeState(null);
  if (!backgroundLocationSupported) return;
  if (await updatesRunning()) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
  }
}

/**
 * Reconcile on app launch / foreground / auth-resolve. If we think we're
 * monitoring, ask the server whether that attendance is still active; stop if
 * not (clocked out elsewhere, shift cancelled, closed by admin). If it IS
 * active but the OS task isn't running (app was killed), restart it.
 */
export async function reconcileMonitoring(): Promise<void> {
  const state = await readState();
  if (!state?.shiftId) {
    if (await updatesRunning()) await stopAttendanceMonitoring();
    return;
  }
  try {
    const server = await getAttendanceState(state.shiftId);
    if (!server.clockedIn || !server.monitorActive) {
      await stopAttendanceMonitoring();
      return;
    }
    if (backgroundLocationSupported && !(await updatesRunning())) {
      await startAttendanceMonitoring(state.shiftId);
    }
  } catch {
    // Offline: leave state as-is; a later reconcile / report will sort it out.
  }
}

export async function getMonitoredShiftId(): Promise<string | null> {
  return (await readState())?.shiftId ?? null;
}
