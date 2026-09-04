import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { MONITOR_STATE_KEY } from '../lib/attendanceConfig';

const mockReportLocation = jest.fn();
const mockGetAttendanceState = jest.fn();
jest.mock('../services/clockService', () => ({
  reportLocation: (...a: unknown[]) => mockReportLocation(...a),
  getAttendanceState: (...a: unknown[]) => mockGetAttendanceState(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const task = require('../tasks/locationTask');
const mockLoc = Location as jest.Mocked<typeof Location>;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockLoc.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
  mockLoc.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
});

describe('shift-aware monitoring lifecycle', () => {
  it('start persists the monitored shift and begins updates', async () => {
    await task.startAttendanceMonitoring('shift-1');
    expect(await task.getMonitoredShiftId()).toBe('shift-1');
    expect(mockLoc.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('stop clears state and stops updates — no zombie task', async () => {
    await task.startAttendanceMonitoring('shift-1');
    mockLoc.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await task.stopAttendanceMonitoring();
    expect(await task.getMonitoredShiftId()).toBeNull();
    expect(mockLoc.stopLocationUpdatesAsync).toHaveBeenCalled();
  });

  it('does not start updates when background permission is denied', async () => {
    mockLoc.requestBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);
    const started = await task.startAttendanceMonitoring('shift-2');
    expect(started).toBe(false);
    // state is still persisted so foreground reporting can continue
    expect(await task.getMonitoredShiftId()).toBe('shift-2');
    expect(mockLoc.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('reportOnce returns false (stop) when the server says attendance is not active', async () => {
    await AsyncStorage.setItem(MONITOR_STATE_KEY, JSON.stringify({ shiftId: 'shift-3' }));
    mockReportLocation.mockResolvedValue({ active: false, reason: 'ALREADY_CLOSED' });
    const keep = await task.reportOnce({ latitude: 1, longitude: 2, accuracy: 5 });
    expect(keep).toBe(false);
  });

  it('reportOnce keeps going on a network error (offline)', async () => {
    await AsyncStorage.setItem(MONITOR_STATE_KEY, JSON.stringify({ shiftId: 'shift-4' }));
    mockReportLocation.mockRejectedValue({ message: 'Network Error' });
    const keep = await task.reportOnce({ latitude: 1, longitude: 2, accuracy: 5 });
    expect(keep).toBe(true);
  });

  it('reconcile stops a zombie monitor the server no longer recognises', async () => {
    await AsyncStorage.setItem(MONITOR_STATE_KEY, JSON.stringify({ shiftId: 'shift-5' }));
    mockLoc.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    mockGetAttendanceState.mockResolvedValue({ clockedIn: false, monitorActive: false });
    await task.reconcileMonitoring();
    expect(await task.getMonitoredShiftId()).toBeNull();
    expect(mockLoc.stopLocationUpdatesAsync).toHaveBeenCalled();
  });

  it('reconcile restarts updates when the server says attendance is still active but the OS task is dead', async () => {
    await AsyncStorage.setItem(MONITOR_STATE_KEY, JSON.stringify({ shiftId: 'shift-6' }));
    mockLoc.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    mockGetAttendanceState.mockResolvedValue({ clockedIn: true, monitorActive: true });
    await task.reconcileMonitoring();
    expect(mockLoc.startLocationUpdatesAsync).toHaveBeenCalled();
    expect(await task.getMonitoredShiftId()).toBe('shift-6');
  });
});
