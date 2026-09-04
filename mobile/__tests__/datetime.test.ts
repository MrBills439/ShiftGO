import {
  fmtDur, fmtDurLong, fmtDurCompact, fmtHM, fmtHours, dateParts,
  shiftWindowStatus, timeAgo, getWeekStart, fmtWeekRange, weekdaysInRange,
  getGreeting, relativeDayLabel, fmtDateOrDash,
} from '../lib/datetime';

const iso = (s: string) => new Date(s).toISOString();

describe('duration formatters', () => {
  const start = iso('2026-09-01T09:00:00');
  test('fmtDur rounds to whole hours', () => {
    expect(fmtDur(start, iso('2026-09-01T17:00:00'))).toBe('8h');
    expect(fmtDur(start, iso('2026-09-01T17:40:00'))).toBe('9h');
  });
  test('fmtDurLong always shows minutes', () => {
    expect(fmtDurLong(start, iso('2026-09-01T17:00:00'))).toBe('8h 00m');
    expect(fmtDurLong(start, iso('2026-09-01T17:30:00'))).toBe('8h 30m');
  });
  test('fmtDurCompact omits zero minutes', () => {
    expect(fmtDurCompact(start, iso('2026-09-01T17:00:00'))).toBe('8h');
    expect(fmtDurCompact(start, iso('2026-09-01T17:30:00'))).toBe('8h 30m');
  });
  test('fmtHM from decimal hours', () => {
    expect(fmtHM(8)).toBe('8h 00m');
    expect(fmtHM(7.5)).toBe('7h 30m');
  });
  test('fmtHours drops trailing .0', () => {
    expect(fmtHours(40)).toBe('40h');
    expect(fmtHours(37.5)).toBe('37.5h');
  });
});

describe('dateParts', () => {
  test('splits into day / num / mon', () => {
    // 2026-09-02 is a Wednesday. Month abbrev is ICU-dependent ("SEP" / "SEPT").
    const p = dateParts(iso('2026-09-02T10:00:00'));
    expect(p.day).toBe('WED');
    expect(p.num).toBe(2);
    expect(p.mon).toMatch(/^SEP/);
  });
});

describe('shiftWindowStatus', () => {
  const now = Date.now();
  test('active when now is inside the window', () => {
    expect(shiftWindowStatus(new Date(now - 3600_000).toISOString(), new Date(now + 3600_000).toISOString())).toBe('active');
  });
  test('upcoming when it has not started', () => {
    expect(shiftWindowStatus(new Date(now + 3600_000).toISOString(), new Date(now + 7200_000).toISOString())).toBe('upcoming');
  });
  test('completed when it has ended', () => {
    expect(shiftWindowStatus(new Date(now - 7200_000).toISOString(), new Date(now - 3600_000).toISOString())).toBe('completed');
  });
});

describe('timeAgo', () => {
  test('recent buckets', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 30_000).toISOString())).toBe('Just now');
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString())).toBe('3h ago');
    expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d ago');
  });
});

describe('week helpers', () => {
  test('getWeekStart returns the Monday at 00:00', () => {
    const wed = new Date('2026-09-02T15:30:00'); // Wednesday
    const mon = getWeekStart(wed);
    expect(mon.getDay()).toBe(1);
    expect(mon.getHours()).toBe(0);
    expect(mon.getDate()).toBe(31); // Mon 31 Aug 2026
  });
  test('fmtWeekRange spans Mon–Sun', () => {
    expect(fmtWeekRange(new Date('2026-08-31T00:00:00'))).toMatch(/^31 Aug – 6 Sep(t)? 2026$/);
  });
});

describe('weekdaysInRange', () => {
  test('counts Mon–Fri only, inclusive', () => {
    // Mon 2026-08-31 .. Fri 2026-09-04 -> 5 weekdays
    expect(weekdaysInRange('2026-08-31', '2026-09-04')).toBe(5);
    // includes a weekend: Fri .. next Mon -> Fri + Mon = 2
    expect(weekdaysInRange('2026-09-04', '2026-09-07')).toBe(2);
    // a single weekend day -> 0
    expect(weekdaysInRange('2026-09-05', '2026-09-06')).toBe(0);
    // reversed -> 0
    expect(weekdaysInRange('2026-09-10', '2026-09-01')).toBe(0);
  });
});

describe('misc', () => {
  test('getGreeting by hour', () => {
    expect(getGreeting(new Date('2026-09-02T08:00:00'))).toBe('Good morning');
    expect(getGreeting(new Date('2026-09-02T14:00:00'))).toBe('Good afternoon');
    expect(getGreeting(new Date('2026-09-02T20:00:00'))).toBe('Good evening');
  });
  test('relativeDayLabel', () => {
    const today = new Date();
    const tmr = new Date();
    tmr.setDate(today.getDate() + 1);
    expect(relativeDayLabel(today.toISOString())).toBe('Today');
    expect(relativeDayLabel(tmr.toISOString())).toBe('Tomorrow');
  });
  test('fmtDateOrDash tolerates null', () => {
    expect(fmtDateOrDash(null)).toBe('—');
    expect(fmtDateOrDash(undefined)).toBe('—');
    expect(fmtDateOrDash('2026-09-02T00:00:00')).toMatch(/^2 Sep(t)? 2026$/);
  });
});
