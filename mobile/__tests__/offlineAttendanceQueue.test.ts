import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPost = jest.fn();
jest.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => mockPost(...a) } }));

import {
  queueOfflineAttendanceEvent,
  loadAttendanceQueue,
  syncAttendanceQueue,
  getAttendanceQueueSummary,
} from '../services/offlineAttendanceQueue';

const base = {
  type: 'CLOCK_IN' as const,
  houseId: 'h1',
  shiftId: 's1',
  latitude: 51.5,
  longitude: -0.1,
  accuracy: 10,
};

function axiosError(status?: number, message = 'boom') {
  return { isAxiosError: true, message, response: status ? { status, data: { message } } : undefined };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockPost.mockReset();
});

describe('queueOfflineAttendanceEvent', () => {
  test('adds a PENDING event to the queue', async () => {
    const e = await queueOfflineAttendanceEvent(base);
    expect(e.syncStatus).toBe('PENDING');
    const q = await loadAttendanceQueue();
    expect(q).toHaveLength(1);
    expect(q[0].shiftId).toBe('s1');
  });

  test('deduplicates a same type+shift event that has not synced', async () => {
    const first = await queueOfflineAttendanceEvent(base);
    const second = await queueOfflineAttendanceEvent(base);
    expect(second.localId).toBe(first.localId);
    expect(await loadAttendanceQueue()).toHaveLength(1);
  });
});

describe('syncAttendanceQueue', () => {
  test('marks the event SYNCED when the API succeeds', async () => {
    await queueOfflineAttendanceEvent(base);
    mockPost.mockResolvedValueOnce({ data: {} });

    const summary = await syncAttendanceQueue();
    expect(mockPost).toHaveBeenCalledWith('/clock/in', expect.objectContaining({ shiftId: 's1', locationSource: 'OFFLINE_SYNC' }));
    expect(summary.pendingCount).toBe(0);
    expect((await loadAttendanceQueue())[0].syncStatus).toBe('SYNCED');
  });

  test('a 409 is treated as an already-applied duplicate (SYNCED)', async () => {
    await queueOfflineAttendanceEvent(base);
    mockPost.mockRejectedValueOnce(axiosError(409));

    await syncAttendanceQueue();
    const q = await loadAttendanceQueue();
    expect(q[0].syncStatus).toBe('SYNCED');
    expect(q[0].resolvedAsDuplicate).toBe(true);
  });

  test('a network error leaves the event retryable (FAILED, not terminal)', async () => {
    await queueOfflineAttendanceEvent(base);
    mockPost.mockRejectedValueOnce(axiosError(undefined));

    await syncAttendanceQueue();
    const q = await loadAttendanceQueue();
    expect(q[0].syncStatus).toBe('FAILED');
    expect(q[0].terminalFailure).toBeFalsy();
  });

  test('a 400 is a terminal failure and is not retried', async () => {
    await queueOfflineAttendanceEvent(base);
    mockPost.mockRejectedValueOnce(axiosError(400));

    await syncAttendanceQueue();
    const q = await loadAttendanceQueue();
    expect(q[0].syncStatus).toBe('FAILED');
    expect(q[0].terminalFailure).toBe(true);

    // a second sync must not call the API again for a terminal failure
    mockPost.mockClear();
    await syncAttendanceQueue();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test('summary reports pending count before sync', async () => {
    await queueOfflineAttendanceEvent(base);
    await queueOfflineAttendanceEvent({ ...base, type: 'CLOCK_OUT', shiftId: 's2' });
    const summary = await getAttendanceQueueSummary();
    expect(summary.pendingCount).toBe(2);
  });

  // Mobile FIXED Attendance V1 — an offline clock-out for a FIXED (Location-
  // backed) shift queues and syncs with locationId, never a fake houseId.
  test('a FIXED (Location-backed) offline clock-out queues and syncs with locationId, no houseId', async () => {
    const { houseId, ...fixedBase } = base;
    await queueOfflineAttendanceEvent({ ...fixedBase, type: 'CLOCK_OUT', shiftId: 's3', locationId: 'loc1' });
    mockPost.mockResolvedValueOnce({ data: {} });

    await syncAttendanceQueue();

    expect(mockPost).toHaveBeenCalledWith('/clock/out', expect.objectContaining({ shiftId: 's3', locationId: 'loc1' }));
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('houseId');
    expect((await loadAttendanceQueue())[0].syncStatus).toBe('SYNCED');
  });
});
