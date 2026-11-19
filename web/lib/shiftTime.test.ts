import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWallTime, shiftTimesFromForm, instantToAgencyParts, formatTimeInZone, addCalendarDays,
} from './shiftTime.ts';

const LON = 'Europe/London';
// 2026 UK clock changes: forward Sun 29 Mar 01:00 GMT -> 02:00 BST;
// back Sun 25 Oct 02:00 BST -> 01:00 GMT.

function ok(input: Parameters<typeof shiftTimesFromForm>[0]) {
  const r = shiftTimesFromForm(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.problem.code}: ${r.problem.message}`);
  return r;
}

test('winter (GMT): agency time equals UTC', () => {
  const r = ok({ date: '2026-11-19', startTime: '09:00', endTime: '17:00', timeZone: LON });
  assert.equal(r.startTime, '2026-11-19T09:00:00.000Z');
  assert.equal(r.endTime, '2026-11-19T17:00:00.000Z');
  assert.equal(r.overnight, false);
});

test('summer (BST): 09:00 is 08:00 UTC, not 09:00 UTC', () => {
  const r = ok({ date: '2026-07-01', startTime: '09:00', endTime: '17:00', timeZone: LON });
  assert.equal(r.startTime, '2026-07-01T08:00:00.000Z');
  assert.equal(r.endTime, '2026-07-01T16:00:00.000Z');
});

test('overnight in winter and summer: end on the next day', () => {
  const w = ok({ date: '2026-11-19', startTime: '20:00', endTime: '08:00', timeZone: LON });
  assert.equal(w.startTime, '2026-11-19T20:00:00.000Z');
  assert.equal(w.endTime, '2026-11-20T08:00:00.000Z');
  assert.equal(w.overnight, true);
  const s = ok({ date: '2026-07-01', startTime: '20:00', endTime: '08:00', timeZone: LON });
  assert.equal(s.startTime, '2026-07-01T19:00:00.000Z');
  assert.equal(s.endTime, '2026-07-02T07:00:00.000Z');
});

test('equal start and end is a 24-hour shift (unchanged behaviour)', () => {
  const r = ok({ date: '2026-11-19', startTime: '08:00', endTime: '08:00', timeZone: LON });
  assert.equal(+new Date(r.endTime) - +new Date(r.startTime), 24 * 3_600_000);
});

test('spring forward: 01:30 on 29 Mar does not exist and is refused', () => {
  assert.deepEqual(resolveWallTime(LON, '2026-03-29', '01:30'), { status: 'nonexistent' });
  const r = shiftTimesFromForm({ date: '2026-03-29', startTime: '01:30', endTime: '09:00', timeZone: LON });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.problem.code, 'NONEXISTENT');
    assert.equal(r.problem.field, 'start');
    assert.match(r.problem.message, /clocks go forward/);
  }
  // An end time in the gap is refused too.
  const e = shiftTimesFromForm({ date: '2026-03-28', startTime: '20:00', endTime: '01:15', timeZone: LON });
  assert.equal(e.ok, false);
  if (!e.ok) assert.equal(e.problem.field, 'end');
});

test('spring forward: an overnight shift across the change is one hour shorter', () => {
  const r = ok({ date: '2026-03-28', startTime: '20:00', endTime: '08:00', timeZone: LON });
  assert.equal(r.startTime, '2026-03-28T20:00:00.000Z'); // GMT
  assert.equal(r.endTime, '2026-03-29T07:00:00.000Z');   // 08:00 BST
  assert.equal((+new Date(r.endTime) - +new Date(r.startTime)) / 3_600_000, 11);
});

test('fall back: 01:30 on 25 Oct happens twice and must be chosen', () => {
  const amb = resolveWallTime(LON, '2026-10-25', '01:30');
  assert.equal(amb.status, 'ambiguous');
  if (amb.status === 'ambiguous') {
    assert.equal(amb.earlier.toISOString(), '2026-10-25T00:30:00.000Z'); // 01:30 BST
    assert.equal(amb.later.toISOString(), '2026-10-25T01:30:00.000Z');   // 01:30 GMT
  }
  const r = shiftTimesFromForm({ date: '2026-10-25', startTime: '01:30', endTime: '09:00', timeZone: LON });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.problem.code, 'AMBIGUOUS');
    assert.deepEqual(r.problem.options?.map((o) => o.choice), ['earlier', 'later']);
    assert.match(r.problem.options?.[0].label ?? '', /BST/);
    assert.match(r.problem.options?.[1].label ?? '', /GMT/);
  }
  assert.equal(ok({ date: '2026-10-25', startTime: '01:30', endTime: '09:00', timeZone: LON, startChoice: 'earlier' }).startTime, '2026-10-25T00:30:00.000Z');
  assert.equal(ok({ date: '2026-10-25', startTime: '01:30', endTime: '09:00', timeZone: LON, startChoice: 'later' }).startTime, '2026-10-25T01:30:00.000Z');
});

test('fall back: an overnight shift across the change is one hour longer', () => {
  const r = ok({ date: '2026-10-24', startTime: '20:00', endTime: '08:00', timeZone: LON });
  assert.equal(r.startTime, '2026-10-24T19:00:00.000Z'); // BST
  assert.equal(r.endTime, '2026-10-25T08:00:00.000Z');   // GMT
  assert.equal((+new Date(r.endTime) - +new Date(r.startTime)) / 3_600_000, 13);
});

test('times around the changes that are not ambiguous resolve normally', () => {
  assert.equal(ok({ date: '2026-03-29', startTime: '00:30', endTime: '03:00', timeZone: LON }).startTime, '2026-03-29T00:30:00.000Z');
  assert.equal(ok({ date: '2026-10-25', startTime: '02:00', endTime: '06:00', timeZone: LON }).startTime, '2026-10-25T02:00:00.000Z');
});

test('stored instants show back as the same agency date and time (edit round-trip)', () => {
  for (const input of [
    { date: '2026-11-19', startTime: '09:00', endTime: '17:00' },
    { date: '2026-07-01', startTime: '20:00', endTime: '08:00' },
    { date: '2026-03-28', startTime: '23:30', endTime: '07:30' },
  ]) {
    const r = ok({ ...input, timeZone: LON });
    assert.deepEqual(instantToAgencyParts(r.startTime, LON), { date: input.date, time: input.startTime });
    assert.equal(instantToAgencyParts(r.endTime, LON).time, input.endTime);
    assert.equal(formatTimeInZone(r.startTime, LON), input.startTime);
  }
});

test('display uses the agency timezone, not the browser or UTC', () => {
  assert.equal(formatTimeInZone('2026-07-01T08:00:00.000Z', LON), '09:00');
  assert.equal(formatTimeInZone('2026-07-01T08:00:00.000Z', 'UTC'), '08:00');
  assert.equal(formatTimeInZone('2026-07-01T08:00:00.000Z', 'Australia/Sydney'), '18:00');
});

test('identical inputs give identical timestamps, whichever form calls it', () => {
  const a = shiftTimesFromForm({ date: '2026-07-01', startTime: '07:00', endTime: '19:30', timeZone: LON });
  const b = shiftTimesFromForm({ date: '2026-07-01', startTime: '07:00', endTime: '19:30', timeZone: LON });
  assert.deepEqual(a, b);
});

test('invalid input is reported, not guessed', () => {
  assert.equal(shiftTimesFromForm({ date: '', startTime: '09:00', endTime: '17:00', timeZone: LON }).ok, false);
  assert.equal(shiftTimesFromForm({ date: '2026-07-01', startTime: '9am', endTime: '17:00', timeZone: LON }).ok, false);
  assert.equal(addCalendarDays('2026-12-31', 1), '2027-01-01');
});
