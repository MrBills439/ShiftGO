/**
 * A London agency, a phone set to New York: every date and time the app shows
 * must be London's, matching the web app.
 *
 * Run with the PROCESS timezone set to New York (the simulated phone):
 *   npm run test:phone-tz        (TZ=America/New_York jest …)
 * It is excluded from the plain `jest` run (jest.config.js) because Jest
 * workers can't change their timezone mid-run; the first test fails loudly
 * if the process isn't actually on New York time.
 */

import {
  setDisplayTimeZone, fmtTime, fmtDate, fmtDateLong, fmtDateLongMonth, dateParts, relativeDayLabel,
  getWeekStart, fmtWeekRange, fmtDayLabel, getGreeting, weekdaysInRange, dayKey, startOfDayPlus, sameMonth,
} from '../lib/datetime';

afterEach(() => {
  setDisplayTimeZone(null);
  jest.useRealTimers();
});

test('the simulated phone really is on New York time', () => {
  expect(new Date('2026-07-01T08:00:00Z').getHours()).toBe(4); // 04:00 EDT
});

test('without an agency timezone the phone clock is used (old behaviour)', () => {
  expect(fmtTime('2026-07-01T08:00:00Z')).toBe('04:00');
});

describe('London agency on a New York phone', () => {
  beforeEach(() => setDisplayTimeZone('Europe/London'));

  test('shift times: summer and winter', () => {
    expect(fmtTime('2026-07-01T08:00:00Z')).toBe('09:00'); // 09:00 BST
    expect(fmtTime('2026-11-19T09:00:00Z')).toBe('09:00'); // 09:00 GMT
  });

  test('calendar dates stored at UTC midnight are not shown as the day before', () => {
    expect(fmtDate('2026-05-01T00:00:00Z')).toBe('1 May 2026');          // New York would say 30 Apr
    expect(fmtDateLongMonth('2026-05-01T00:00:00Z')).toBe('1 May 2026');
  });

  test('a shift at 00:30 BST is on the London day, not the New York one', () => {
    const iso = '2026-07-01T23:30:00Z'; // Thu 2 Jul 00:30 in London, Wed 1 Jul 19:30 in New York
    expect(dateParts(iso)).toEqual({ day: 'THU', num: 2, mon: 'JUL' });
    expect(fmtDateLong(iso)).toMatch(/^Thursday,? 2 July 2026$/);
    expect(dayKey(iso)).toBe('2026-07-02');
  });

  test('"Today" / "Tomorrow" follow London', () => {
    jest.useFakeTimers({ now: new Date('2026-07-01T22:30:00Z') }); // 23:30 London, 18:30 New York
    expect(relativeDayLabel('2026-07-01T23:30:00Z')).toBe('Tomorrow'); // 00:30 London on the 2nd
    expect(relativeDayLabel('2026-07-01T20:00:00Z')).toBe('Today');
  });

  test('the week starts at Monday 00:00 London time', () => {
    const start = getWeekStart(new Date('2026-07-05T23:30:00Z')); // Mon 6 Jul 00:30 London
    expect(start.toISOString()).toBe('2026-07-05T23:00:00.000Z');   // Mon 00:00 BST
    expect(fmtWeekRange(start)).toBe('6 Jul – 12 Jul 2026');
    expect(fmtDayLabel(startOfDayPlus(start, 6))).toMatch(/^Sun,? 12 Jul$/);
  });

  test('week days across the October clock change are whole London days', () => {
    const start = getWeekStart(new Date('2026-10-22T12:00:00Z')); // week of Mon 19 Oct
    expect(start.toISOString()).toBe('2026-10-18T23:00:00.000Z');
    expect(startOfDayPlus(start, 7).toISOString()).toBe('2026-10-26T00:00:00.000Z'); // Mon 26 Oct 00:00 GMT
  });

  test('greeting, month and weekday counting use London', () => {
    expect(getGreeting(new Date('2026-07-01T11:30:00Z'))).toBe('Good afternoon'); // 12:30 London, 07:30 New York
    expect(sameMonth('2026-06-30T23:30:00Z', '2026-07-15T12:00:00Z')).toBe(true); // 1 Jul 00:30 London
    expect(weekdaysInRange('2026-05-04T00:00:00Z', '2026-05-04T00:00:00Z')).toBe(1); // Mon in London (Sun in New York)
  });
});

test('leave pricing: plain dates are calendar dates on any phone', () => {
  // Mon 31 Aug .. Fri 4 Sep 2026 = 5 weekdays, with or without an agency timezone.
  expect(weekdaysInRange('2026-08-31', '2026-09-04')).toBe(5);
  setDisplayTimeZone('Europe/London');
  expect(weekdaysInRange('2026-08-31', '2026-09-04')).toBe(5);
});

test('signing out returns to the phone timezone', () => {
  setDisplayTimeZone('Europe/London');
  setDisplayTimeZone(null);
  expect(fmtTime('2026-07-01T08:00:00Z')).toBe('04:00');
});

test('an invalid timezone is ignored, never crashes', () => {
  setDisplayTimeZone('Not/AZone');
  expect(fmtTime('2026-07-01T08:00:00Z')).toBe('04:00');
});
