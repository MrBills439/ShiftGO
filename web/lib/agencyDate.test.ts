import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayInTimeZone, mondayOf, addDays, defaultShiftDate } from './agencyDate.ts';

// Thursday 19 November 2026, 10:00 UTC (the date of the live review).
const THU_MORNING = new Date('2026-11-19T10:00:00Z');

test('generic Create shift defaults to today, not the Monday of the week', () => {
  assert.equal(defaultShiftDate({ timeZone: 'Europe/London', now: THU_MORNING }), '2026-11-19');
  assert.notEqual(defaultShiftDate({ timeZone: 'Europe/London', now: THU_MORNING }), mondayOf('2026-11-19'));
});

test('a calendar cell keeps its own date, including past dates', () => {
  assert.equal(defaultShiftDate({ cellDate: '2026-11-21', timeZone: 'Europe/London', now: THU_MORNING }), '2026-11-21');
  assert.equal(defaultShiftDate({ cellDate: '2026-10-01', timeZone: 'Europe/London', now: THU_MORNING }), '2026-10-01');
});

test("today follows the agency's timezone, not UTC or the browser", () => {
  // 23:30 UTC on 18 Nov is already 19 Nov in Sydney and still 18 Nov in London.
  const lateUtc = new Date('2026-11-18T23:30:00Z');
  assert.equal(todayInTimeZone('Europe/London', lateUtc), '2026-11-18');
  assert.equal(todayInTimeZone('Australia/Sydney', lateUtc), '2026-11-19');
  // British Summer Time: 23:30 UTC on 1 July is 00:30 on 2 July in London.
  assert.equal(todayInTimeZone('Europe/London', new Date('2026-07-01T23:30:00Z')), '2026-07-02');
});

test('an invalid or missing timezone still gives a date', () => {
  assert.match(todayInTimeZone('Not/AZone', THU_MORNING), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(todayInTimeZone(null, THU_MORNING), /^\d{4}-\d{2}-\d{2}$/);
});

test('week maths is on calendar dates', () => {
  assert.equal(mondayOf('2026-11-19'), '2026-11-16');
  assert.equal(mondayOf('2026-11-16'), '2026-11-16');
  assert.equal(mondayOf('2026-11-22'), '2026-11-16'); // Sunday belongs to the week before
  assert.equal(addDays('2026-10-25', 1), '2026-10-26'); // across the UK clock change
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
