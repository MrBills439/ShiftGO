// The Clock screen is EMPLOYEE SELF-SERVICE: it must load the signed-in
// employee's own scheduled shift whatever their system role. GET /shifts is
// role-scoped for administration (manager -> their houses, team leader -> their
// house, HR -> the whole agency), so the app must ask for the explicit
// `mine=true` mode. These tests run the app's real data-loading and selection
// code against a fake /shifts endpoint that reproduces that role scoping — so
// they fail if the app ever stops asking for the self-service mode.

type Role = 'WORKER' | 'TEAM_LEADER' | 'MANAGER' | 'HR';
type FakeShift = {
  id: string; workerId: string; kind: 'ROTA' | 'FIXED' | 'FLEXIBLE';
  houseId: string | null; locationId: string | null;
  startTime: string; endTime: string | null; date: string; status: string;
  house: { id: string; name: string } | null; location: { id: string; name: string } | null;
  timesheet: null; shiftType: 'LONG_DAY';
};
type Employee = { id: string; role: Role; workPatternType: 'ROTA' | 'FIXED' | 'FLEXIBLE'; managesHouse?: string; teamLeaderOfHouse?: string };

const HOUR = 3_600_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const HOUSE = { id: 'house-1', name: 'Elm House' };
const OFFICE = { id: 'loc-1', name: 'Head Office' };

function mk(id: string, workerId: string, kind: FakeShift['kind'], over: Partial<FakeShift> = {}): FakeShift {
  return {
    id, workerId, kind,
    houseId: kind === 'ROTA' ? HOUSE.id : null, locationId: kind === 'ROTA' ? null : OFFICE.id,
    house: kind === 'ROTA' ? HOUSE : null, location: kind === 'ROTA' ? null : OFFICE,
    // window open right now -> the shift an employee can clock into
    startTime: iso(NOW - HOUR), endTime: iso(NOW + 7 * HOUR), date: iso(NOW), status: 'SCHEDULED',
    timesheet: null, shiftType: 'LONG_DAY', ...over,
  };
}

const employees: Record<string, Employee> = {
  worker: { id: 'u-worker', role: 'WORKER', workPatternType: 'ROTA' },
  teamLeader: { id: 'u-tl', role: 'TEAM_LEADER', workPatternType: 'ROTA', teamLeaderOfHouse: HOUSE.id },
  manager: { id: 'u-mgr', role: 'MANAGER', workPatternType: 'FIXED', managesHouse: HOUSE.id },
  hrFixed: { id: 'u-hr', role: 'HR', workPatternType: 'FIXED' },
  hrFlex: { id: 'u-hrflex', role: 'HR', workPatternType: 'FLEXIBLE' },
};

const allShifts: FakeShift[] = [
  mk('s-worker', 'u-worker', 'ROTA'),
  mk('s-tl', 'u-tl', 'ROTA'),
  mk('s-mgr', 'u-mgr', 'FIXED'),
  mk('s-hr', 'u-hr', 'FIXED'),
  mk('s-coworker', 'u-coworker', 'ROTA'), // someone else, at the house the manager/TL run
  mk('s-other-fixed', 'u-coworker', 'FIXED'), // someone else's office shift
  mk('s-hrflex-session', 'u-hrflex', 'FLEXIBLE', { endTime: null, status: 'IN_PROGRESS' }),
];

let currentUser: Employee = employees.worker;
const requests: { url: string; params?: Record<string, unknown> }[] = [];

/** The backend's real behaviour: role-scoped unless `mine === true`, which is
 *  the authenticated employee's own ROTA/FIXED shifts. */
function mockFakeServer(url: string, config?: { params?: Record<string, unknown> }) {
  requests.push({ url, params: config?.params });
  const scheduled = allShifts.filter((s) => s.kind !== 'FLEXIBLE');
  let rows: FakeShift[];
  if (config?.params?.mine === true) {
    rows = scheduled.filter((s) => s.workerId === currentUser.id);
  } else if (currentUser.role === 'WORKER') {
    rows = scheduled.filter((s) => s.workerId === currentUser.id);
  } else if (currentUser.role === 'MANAGER') {
    rows = scheduled.filter((s) => s.houseId === currentUser.managesHouse);
  } else if (currentUser.role === 'TEAM_LEADER') {
    rows = scheduled.filter((s) => s.houseId === currentUser.teamLeaderOfHouse);
  } else {
    rows = scheduled; // HR: whole agency
  }
  return Promise.resolve({ data: { data: rows } });
}

jest.mock('../services/api', () => ({
  api: { get: (...a: [string, { params?: Record<string, unknown> }?]) => mockFakeServer(...a), post: jest.fn() },
}));

import { getMyShifts as clockGetMyShifts } from '../services/clockService';
import { getMyShifts as rotaGetMyShifts } from '../services/rotaService';
import { splitShifts } from '../hooks/useShifts';
import { getOpenShift, getNextShift } from '../lib/shiftCategory';
import { isFlexibleEmployee } from '../lib/flexibleClock';
import { manualClockIn, manualClockOut } from '../services/clockService';
import { attendanceTargetFor, attendanceTargetIds } from '../lib/attendanceTarget';
import type { Shift } from '../types';

// What the Clock screen ends up with for an employee: load -> split -> pick the
// shift whose window is open now (exactly the screen's own selection code).
async function clockScreenShiftFor(emp: Employee) {
  currentUser = emp;
  const shifts = (await clockGetMyShifts()) as Shift[];
  const { active, upcoming } = splitShifts(shifts, NOW);
  const activeShift = active ?? getOpenShift(upcoming, new Date(NOW));
  return { shifts, activeShift, next: getNextShift(upcoming, activeShift, new Date(NOW)) };
}

beforeEach(() => { requests.length = 0; });

describe('the app asks for the explicit self-service mode', () => {
  test('20. getMyShifts sends mine=true and never a workerId / houseId / role', async () => {
    currentUser = employees.manager;
    await clockGetMyShifts();
    expect(requests).toEqual([{ url: '/shifts', params: { mine: true } }]);
    const sent = requests[0].params!;
    for (const forbidden of ['workerId', 'houseId', 'role', 'agencyId', 'kind']) expect(sent).not.toHaveProperty(forbidden);
  });

  test('20. so does the rota service\'s copy of the same call', async () => {
    currentUser = employees.hrFixed;
    await rotaGetMyShifts();
    expect(requests).toEqual([{ url: '/shifts', params: { mine: true } }]);
  });

  test('sanity: without the mode the fake server (like the real one) is role-scoped', async () => {
    currentUser = employees.hrFixed;
    const { api } = jest.requireMock('../services/api');
    const res = await api.get('/shifts');
    expect(res.data.data.length).toBeGreaterThan(1); // HR would get the whole agency
  });
});

describe('each employee loads their OWN shift, whatever their system role', () => {
  test('15. WORKER + ROTA', async () => {
    const r = await clockScreenShiftFor(employees.worker);
    expect(r.activeShift?.id).toBe('s-worker');
    expect(r.activeShift?.kind).toBe('ROTA');
    expect(attendanceTargetFor(r.activeShift)?.kind).toBe('HOUSE');
  });

  test('16. TEAM_LEADER + ROTA (not the house\'s shifts)', async () => {
    const r = await clockScreenShiftFor(employees.teamLeader);
    expect(r.activeShift?.id).toBe('s-tl');
    expect(r.shifts.map((s) => s.id)).toEqual(['s-tl']);
  });

  test('17. MANAGER + FIXED (not the managed house\'s shifts)', async () => {
    const r = await clockScreenShiftFor(employees.manager);
    expect(r.activeShift?.id).toBe('s-mgr');
    expect(r.activeShift?.kind).toBe('FIXED');
    expect(attendanceTargetFor(r.activeShift)).toMatchObject({ kind: 'LOCATION', id: 'loc-1' });
    expect(r.shifts.map((s) => s.id)).toEqual(['s-mgr']);
  });

  test('18. HR + FIXED (not the whole agency)', async () => {
    const r = await clockScreenShiftFor(employees.hrFixed);
    expect(r.activeShift?.id).toBe('s-hr');
    expect(r.shifts.map((s) => s.id)).toEqual(['s-hr']);
  });

  test('21. another employee\'s shift is never selected or displayed, for any role', async () => {
    for (const emp of Object.values(employees)) {
      const r = await clockScreenShiftFor(emp);
      expect(r.shifts.every((s) => s.workerId === emp.id)).toBe(true);
      expect(r.activeShift === null || r.activeShift.workerId === emp.id).toBe(true);
      expect(r.next === null || r.next.workerId === emp.id).toBe(true);
      expect(r.shifts.map((s) => s.id)).not.toContain('s-coworker');
      expect(r.shifts.map((s) => s.id)).not.toContain('s-other-fixed');
    }
  });
});

describe('FLEXIBLE employees use the location flow, not a scheduled shift', () => {
  test('19. HR + FLEXIBLE is a flexible employee; the same HR role with FIXED is not', () => {
    expect(isFlexibleEmployee(employees.hrFlex)).toBe(true);
    expect(isFlexibleEmployee(employees.hrFixed)).toBe(false);
    expect(isFlexibleEmployee(employees.manager)).toBe(false);
    expect(isFlexibleEmployee(employees.teamLeader)).toBe(false);
    expect(isFlexibleEmployee(null)).toBe(false);
    expect(isFlexibleEmployee({})).toBe(false);
  });

  test('19. the flexible attendance session never comes back as a scheduled shift', async () => {
    const r = await clockScreenShiftFor(employees.hrFlex);
    expect(r.shifts).toEqual([]);
    expect(r.activeShift).toBeNull();
  });
});

describe('22. clock-in / clock-out requests are unchanged', () => {
  test('a shift clock-in still names the shift and its target', async () => {
    const { api } = jest.requireMock('../services/api');
    api.post.mockResolvedValue({ data: { data: {} } });
    const r = await clockScreenShiftFor(employees.manager);
    const ids = attendanceTargetIds(attendanceTargetFor(r.activeShift));
    await manualClockIn(r.activeShift!.id, { ...ids, latitude: 51.5, longitude: -0.12 });
    await manualClockOut(r.activeShift!.id, { ...ids });
    expect(api.post).toHaveBeenNthCalledWith(1, '/clock/in', expect.objectContaining({ shiftId: 's-mgr', locationId: 'loc-1' }));
    expect(api.post).toHaveBeenNthCalledWith(2, '/clock/out', expect.objectContaining({ shiftId: 's-mgr', locationId: 'loc-1' }));
  });
});
