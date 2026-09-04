import * as Location from 'expo-location';
import { captureAttendanceLocation } from '../lib/captureLocation';

const mockLoc = Location as jest.Mocked<typeof Location>;

beforeEach(() => {
  jest.clearAllMocks();
  mockLoc.hasServicesEnabledAsync.mockResolvedValue(true);
  mockLoc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true } as never);
  mockLoc.getCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 51.5, longitude: -0.12, accuracy: 8 },
    timestamp: 1_700_000_000_000,
  } as never);
});

describe('captureAttendanceLocation', () => {
  it('returns a usable fix with capturedAt', async () => {
    const r = await captureAttendanceLocation();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r).toEqual(expect.objectContaining({ latitude: 51.5, longitude: -0.12, accuracy: 8, lowAccuracy: false }));
      expect(typeof r.capturedAt).toBe('string');
    }
  });

  it('flags a low-accuracy fix', async () => {
    mockLoc.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 51.5, longitude: -0.12, accuracy: 250 }, timestamp: Date.now(),
    } as never);
    const r = await captureAttendanceLocation();
    expect(r.ok && r.lowAccuracy).toBe(true);
  });

  it('reports SERVICES_DISABLED when location services are off', async () => {
    mockLoc.hasServicesEnabledAsync.mockResolvedValue(false);
    const r = await captureAttendanceLocation();
    expect(r).toEqual({ ok: false, reason: 'SERVICES_DISABLED' });
  });

  it('reports PERMISSION_DENIED and does not fabricate coordinates', async () => {
    mockLoc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false } as never);
    const r = await captureAttendanceLocation();
    expect(r).toEqual({ ok: false, reason: 'PERMISSION_DENIED' });
  });

  it('reports TIMEOUT when a fix never arrives', async () => {
    mockLoc.getCurrentPositionAsync.mockImplementation(() => new Promise(() => {}) as never);
    const r = await captureAttendanceLocation();
    expect(r).toEqual({ ok: false, reason: 'TIMEOUT' });
  }, 20_000);

  it('reports GPS_UNAVAILABLE when the OS throws', async () => {
    mockLoc.getCurrentPositionAsync.mockRejectedValue(new Error('location unavailable'));
    const r = await captureAttendanceLocation();
    expect(r).toEqual({ ok: false, reason: 'GPS_UNAVAILABLE' });
  });
});
