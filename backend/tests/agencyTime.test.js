const {
  DEFAULT_AGENCY_TIMEZONE,
  isValidTimeZone,
  resolveTimeZone,
  agencyDayRange,
  agencyDayKey,
} = require('../src/lib/agencyTime');

const iso = (d) => d.toISOString();

describe('agencyTime — timezone resolution', () => {
  test('accepts valid IANA zones, rejects junk', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('Pacific/Auckland')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });

  test('resolveTimeZone falls back to the pilot default', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveTimeZone('garbage')).toBe(DEFAULT_AGENCY_TIMEZONE);
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_AGENCY_TIMEZONE);
    expect(DEFAULT_AGENCY_TIMEZONE).toBe('Europe/London');
  });
});

describe('agencyTime — agency day is computed in the configured timezone', () => {
  test('Europe/London in summer (BST, UTC+1): day starts at 23:00Z the previous date', () => {
    const r = agencyDayRange('Europe/London', new Date('2025-07-15T09:00:00Z'));
    expect(iso(r.start)).toBe('2025-07-14T23:00:00.000Z');
    expect(iso(r.end)).toBe('2025-07-15T23:00:00.000Z');
  });

  test('Europe/London in winter (GMT, UTC+0): day aligns with UTC midnight', () => {
    const r = agencyDayRange('Europe/London', new Date('2025-01-15T09:00:00Z'));
    expect(iso(r.start)).toBe('2025-01-15T00:00:00.000Z');
    expect(iso(r.end)).toBe('2025-01-16T00:00:00.000Z');
  });

  test('same instant, different agencies -> different agency days', () => {
    const instant = new Date('2025-07-15T02:00:00Z'); // 03:00 London (BST), 22:00 (14th) New York (EDT)
    const london = agencyDayRange('Europe/London', instant);
    const newYork = agencyDayRange('America/New_York', instant);
    expect(iso(london.start)).toBe('2025-07-14T23:00:00.000Z'); // agency day = 15 Jul
    expect(iso(newYork.start)).toBe('2025-07-14T04:00:00.000Z'); // agency day = 14 Jul
    expect(newYork.start.getTime()).toBeLessThan(london.start.getTime());
  });

  test('Southern-hemisphere zone east of UTC (Pacific/Auckland)', () => {
    // 2025-07-15T02:00Z -> 14:00 on the 15th in Auckland (NZST, UTC+12).
    const r = agencyDayRange('Pacific/Auckland', new Date('2025-07-15T02:00:00Z'));
    expect(iso(r.start)).toBe('2025-07-14T12:00:00.000Z');
    expect(iso(r.end)).toBe('2025-07-15T12:00:00.000Z');
  });

  test('an unknown timezone behaves exactly like the default', () => {
    const instant = new Date('2025-07-15T09:00:00Z');
    expect(agencyDayRange('Mars/Olympus', instant)).toEqual(agencyDayRange('Europe/London', instant));
  });
});

describe('agencyTime — DST transitions for Europe/London', () => {
  test('spring forward (30 Mar 2025): the agency day is 23 hours long', () => {
    const r = agencyDayRange('Europe/London', new Date('2025-03-30T12:00:00Z'));
    // Local midnight on the 30th is still GMT -> 00:00Z; BST begins at 01:00Z.
    expect(iso(r.start)).toBe('2025-03-30T00:00:00.000Z');
    // Local midnight on the 31st is BST -> 23:00Z on the 30th.
    expect(iso(r.end)).toBe('2025-03-30T23:00:00.000Z');
    expect(r.end.getTime() - r.start.getTime()).toBe(23 * 3600 * 1000);
  });

  test('fall back (26 Oct 2025): the agency day is 25 hours long', () => {
    const r = agencyDayRange('Europe/London', new Date('2025-10-26T12:00:00Z'));
    // Local midnight on the 26th is still BST -> 23:00Z on the 25th.
    expect(iso(r.start)).toBe('2025-10-25T23:00:00.000Z');
    // Local midnight on the 27th is GMT -> 00:00Z on the 27th.
    expect(iso(r.end)).toBe('2025-10-27T00:00:00.000Z');
    expect(r.end.getTime() - r.start.getTime()).toBe(25 * 3600 * 1000);
  });
});

describe('agencyTime — records around UTC midnight fall on the right agency day', () => {
  test('Europe/London summer: 23:30Z belongs to the NEXT calendar day', () => {
    expect(agencyDayKey('Europe/London', new Date('2025-07-14T23:30:00Z'))).toBe('2025-07-15');
    expect(agencyDayKey('Europe/London', new Date('2025-07-14T22:30:00Z'))).toBe('2025-07-14');
  });

  test('Europe/London winter: 23:30Z belongs to the same calendar day', () => {
    expect(agencyDayKey('Europe/London', new Date('2025-01-14T23:30:00Z'))).toBe('2025-01-14');
    expect(agencyDayKey('Europe/London', new Date('2025-01-15T00:30:00Z'))).toBe('2025-01-15');
  });

  test('a 23:30Z record is inside the agency-day window for that BST day', () => {
    const rec = new Date('2025-07-14T23:30:00Z');
    const day = agencyDayRange('Europe/London', new Date('2025-07-15T10:00:00Z'));
    expect(rec.getTime()).toBeGreaterThanOrEqual(day.start.getTime());
    expect(rec.getTime()).toBeLessThan(day.end.getTime());
  });
});
