import { leaveDayParts, fmtLeaveDays, nextDayCaption, DEFAULT_DAILY_HOURS } from '../lib/leave';

describe('leaveDayParts', () => {
  it('splits an exact multiple into whole days with no remainder', () => {
    expect(leaveDayParts(75, 7.5)).toMatchObject({ whole: 10, remHours: 0, neg: false });
  });

  it('keeps the leftover hours as remHours', () => {
    expect(leaveDayParts(78, 7.5)).toMatchObject({ whole: 10, remHours: 3 });
  });

  it('handles a single day', () => {
    expect(leaveDayParts(7.5, 7.5)).toMatchObject({ whole: 1, remHours: 0 });
  });

  it('handles zero', () => {
    expect(leaveDayParts(0, 7.5)).toMatchObject({ whole: 0, remHours: 0 });
  });

  it('is not tripped up by floating point (15 / 7.5)', () => {
    expect(leaveDayParts(15, 7.5).whole).toBe(2);
    expect(leaveDayParts(15, 7.5).remHours).toBe(0);
  });

  it('flags negative balances and never returns a negative remainder', () => {
    const p = leaveDayParts(-10, 7.5);
    expect(p.neg).toBe(true);
    expect(p.remHours).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the default daily-hours figure', () => {
    expect(leaveDayParts(DEFAULT_DAILY_HOURS * 3).whole).toBe(3);
  });
});

describe('fmtLeaveDays', () => {
  it('shows whole days only, never a decimal', () => {
    expect(fmtLeaveDays(78, 7.5)).toBe('10 days');
  });
  it('uses the singular for exactly one day', () => {
    expect(fmtLeaveDays(7.5, 7.5)).toBe('1 day');
  });
  it('shows 0 days for an empty balance', () => {
    expect(fmtLeaveDays(0, 7.5)).toBe('0 days');
  });
});

describe('nextDayCaption', () => {
  it('describes the partial day still accruing', () => {
    expect(nextDayCaption(78, 7.5)).toBe('+3h towards your next day');
  });
  it('is null when the balance lands on a whole day', () => {
    expect(nextDayCaption(75, 7.5)).toBeNull();
  });
  it('is null for a negative balance', () => {
    expect(nextDayCaption(-5, 7.5)).toBeNull();
  });
});
