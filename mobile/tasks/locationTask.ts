import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { autoCheckin } from '../services/clockService';
import { geofenceExit } from '../services/clockService';

export const LOCATION_TASK = 'shiftgo-background-location';

const INSIDE_KEY = 'shiftgo_inside_geofences';

async function getInsideState(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(INSIDE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

async function setInsideState(ids: Set<string>) {
  await AsyncStorage.setItem(INSIDE_KEY, JSON.stringify([...ids]));
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[LocationTask]', error.message);
    return;
  }
  const { locations } = data as { locations: Location.LocationObject[] };
  const loc = locations?.[0];
  if (!loc) return;

  const { latitude, longitude } = loc.coords;

  try {
    // Auto clock-in: backend checks all active shifts and clocks in if inside geofence
    const checkinResults = await autoCheckin(latitude, longitude);

    // Track which house geofences the worker is currently inside
    const previouslyInside = await getInsideState();
    const nowInside = new Set<string>(
      (checkinResults as Array<{ houseId: string }>)
        .filter((r) => !('alreadyClockedIn' in r))
        .map((r) => r.houseId)
    );

    // Detect exits: was inside before, not inside now
    const exits = [...previouslyInside].filter((id) => !nowInside.has(id));

    if (exits.length > 0) {
      await geofenceExit(latitude, longitude);
    }

    await setInsideState(nowInside);
  } catch (err) {
    console.error('[LocationTask] error', err);
  }
});

export async function startBackgroundLocation() {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') return false;

  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (isRunning) return true;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 30_000,
    distanceInterval: 20,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'ShiftGO',
      notificationBody: 'Monitoring shift location…',
      notificationColor: '#005f55',
    },
  });
  return true;
}

export async function stopBackgroundLocation() {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    await AsyncStorage.removeItem(INSIDE_KEY);
  }
}
