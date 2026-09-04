import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AxiosError } from 'axios';
import { api } from './api';

export type OfflineAttendanceType = 'CLOCK_IN' | 'CLOCK_OUT';
export type AttendanceSyncStatus = 'PENDING' | 'SYNCING' | 'FAILED' | 'SYNCED';

export interface OfflineAttendanceEvent {
  localId: string;
  type: OfflineAttendanceType;
  houseId: string;
  shiftId: string;
  timestamp: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  capturedAt?: string;
  reason?: string;
  syncStatus: AttendanceSyncStatus;
  retryCount: number;
  lastError?: string;
  syncedAt?: string;
  resolvedAsDuplicate?: boolean;
  terminalFailure?: boolean;
}

export interface AttendanceQueueSummary {
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  lastStatus: AttendanceSyncStatus | null;
  lastMessage: string | null;
}

const QUEUE_KEY = 'shiftgo_offline_attendance_queue_v1';
const listeners = new Set<() => void>();
let syncInFlight = false;

function localId() {
  return `attendance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sortByTimestamp(events: OfflineAttendanceEvent[]) {
  return [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function isNetworkError(error: unknown) {
  const err = error as AxiosError;
  return Boolean(err?.isAxiosError && !err.response);
}

function isResolvedDuplicate(error: unknown) {
  const err = error as AxiosError<{ message?: string }>;
  return err?.response?.status === 409;
}

function isTerminalHttpError(error: unknown) {
  const err = error as AxiosError;
  const status = err?.response?.status;
  return Boolean(status && status >= 400 && status < 500 && status !== 409);
}

function errorMessage(error: unknown) {
  const err = error as AxiosError<{ message?: string; error?: { message?: string } }>;
  return err?.response?.data?.message
    ?? err?.response?.data?.error?.message
    ?? err?.message
    ?? 'Sync failed';
}

async function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeAttendanceQueue(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadAttendanceQueue(): Promise<OfflineAttendanceEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAttendanceQueue(events: OfflineAttendanceEvent[]) {
  const synced = events
    .filter((event) => event.syncStatus === 'SYNCED')
    .sort((a, b) => new Date(b.syncedAt ?? b.timestamp).getTime() - new Date(a.syncedAt ?? a.timestamp).getTime())
    .slice(0, 20);
  const active = events.filter((event) => event.syncStatus !== 'SYNCED');
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...active, ...synced]));
  await notify();
}

export async function captureAttendanceLocation() {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return {};
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      capturedAt: new Date(location.timestamp || Date.now()).toISOString(),
    };
  } catch {
    return {};
  }
}

export async function queueOfflineAttendanceEvent(input: {
  type: OfflineAttendanceType;
  houseId: string;
  shiftId: string;
  timestamp?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  capturedAt?: string;
  reason?: string;
}): Promise<OfflineAttendanceEvent> {
  const queue = await loadAttendanceQueue();
  const existing = queue.find((event) =>
    event.type === input.type
    && event.shiftId === input.shiftId
    && event.syncStatus !== 'SYNCED'
  );

  if (existing) return existing;

  const location = input.latitude != null && input.longitude != null
    ? { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy, capturedAt: input.capturedAt }
    : await captureAttendanceLocation();
  const event: OfflineAttendanceEvent = {
    localId: localId(),
    type: input.type,
    houseId: input.houseId,
    shiftId: input.shiftId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...location,
    reason: input.reason ?? 'Manual offline attendance fallback',
    syncStatus: 'PENDING',
    retryCount: 0,
  };

  await saveAttendanceQueue([...queue, event]);
  return event;
}

async function postAttendanceEvent(event: OfflineAttendanceEvent) {
  const endpoint = event.type === 'CLOCK_IN' ? '/clock/in' : '/clock/out';
  await api.post(endpoint, {
    houseId: event.houseId,
    shiftId: event.shiftId,
    timestamp: event.timestamp,
    latitude: event.latitude,
    longitude: event.longitude,
    accuracy: event.accuracy,
    capturedAt: event.capturedAt,
    reason: event.reason,
    locationSource: 'OFFLINE_SYNC',
  });
}

export async function syncAttendanceQueue(): Promise<AttendanceQueueSummary> {
  if (syncInFlight) return getAttendanceQueueSummary();
  syncInFlight = true;

  try {
    let queue = sortByTimestamp(await loadAttendanceQueue());
    for (const event of queue) {
      // A leftover 'SYNCING' means a previous run died mid-flight — retry it,
      // don't skip it (that used to strand events forever).
      if (event.syncStatus === 'SYNCED' || event.terminalFailure) continue;

      queue = queue.map((item) => item.localId === event.localId
        ? { ...item, syncStatus: 'SYNCING', retryCount: item.retryCount + 1, lastError: undefined }
        : item);
      await saveAttendanceQueue(queue);

      try {
        await postAttendanceEvent(event);
        queue = queue.map((item) => item.localId === event.localId
          ? { ...item, syncStatus: 'SYNCED', syncedAt: new Date().toISOString(), lastError: undefined }
          : item);
      } catch (error) {
        if (isResolvedDuplicate(error)) {
          queue = queue.map((item) => item.localId === event.localId
            ? {
                ...item,
                syncStatus: 'SYNCED',
                syncedAt: new Date().toISOString(),
                resolvedAsDuplicate: true,
                lastError: undefined,
              }
            : item);
        } else {
          queue = queue.map((item) => item.localId === event.localId
            ? {
                ...item,
                syncStatus: 'FAILED',
                lastError: errorMessage(error),
                terminalFailure: isTerminalHttpError(error),
              }
            : item);
          if (isNetworkError(error)) {
            // Persist the FAILED state before bailing so the next sync retries
            // it, then stop — the connection is down, no point trying the rest.
            await saveAttendanceQueue(queue);
            break;
          }
        }
      }

      await saveAttendanceQueue(queue);
    }

    return getAttendanceQueueSummary();
  } finally {
    syncInFlight = false;
  }
}

export async function getAttendanceQueueSummary(): Promise<AttendanceQueueSummary> {
  const queue = await loadAttendanceQueue();
  const pendingCount = queue.filter((event) => event.syncStatus === 'PENDING').length;
  const syncingCount = queue.filter((event) => event.syncStatus === 'SYNCING').length;
  const failedCount = queue.filter((event) => event.syncStatus === 'FAILED').length;
  const lastEvent = [...queue].sort((a, b) => {
    const left = new Date(a.syncedAt ?? a.timestamp).getTime();
    const right = new Date(b.syncedAt ?? b.timestamp).getTime();
    return right - left;
  })[0];

  let lastMessage: string | null = null;
  if (lastEvent?.syncStatus === 'PENDING') lastMessage = 'Pending sync';
  if (lastEvent?.syncStatus === 'SYNCING') lastMessage = 'Syncing attendance';
  if (lastEvent?.syncStatus === 'FAILED') lastMessage = 'Sync failed';
  if (lastEvent?.syncStatus === 'SYNCED') lastMessage = lastEvent.resolvedAsDuplicate ? 'Already synced' : 'Synced';

  return {
    pendingCount,
    syncingCount,
    failedCount,
    lastStatus: lastEvent?.syncStatus ?? null,
    lastMessage,
  };
}

export { isNetworkError };
