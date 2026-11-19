import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryView, coverageView, setupSteps, setupComplete, noFrontlineStaffMessage } from './dashboardView.ts';

test('a failed request is an error, never healthy zeros', () => {
  assert.equal(queryView({ isLoading: false, isError: true, hasData: false }), 'error');
  assert.equal(queryView({ isLoading: true, isError: false, hasData: false }), 'loading');
  assert.equal(queryView({ isLoading: false, isError: false, hasData: true }), 'ready');
  // A failed background refresh keeps the older data but must say so.
  assert.equal(queryView({ isLoading: false, isError: true, hasData: true }), 'stale');
});

test('zero shifts: no coverage rate is implied', () => {
  const v = coverageView({ scheduled: 0, covered: 0, uncovered: 0, percent: null });
  assert.equal(v.measured, false);
  assert.equal(v.headline, 'No shifts scheduled');
  assert.doesNotMatch(`${v.headline} ${v.detail}`, /100|%/);
});

test('coverage is stated with its denominator', () => {
  assert.deepEqual(coverageView({ scheduled: 3, covered: 2, uncovered: 1, percent: 67 }),
    { measured: true, headline: '2 of 3 covered', detail: '1 without a worker' });
  assert.equal(coverageView({ scheduled: 2, covered: 2, uncovered: 0, percent: 100 }).headline, '2 of 2 covered');
});

test('the empty staff message names who is counted', () => {
  assert.match(noFrontlineStaffMessage(), /workers/i);
  assert.doesNotMatch(noFrontlineStaffMessage(), /^No staff/);
});

const fresh = { employeeIdPrefixSet: false, services: 0, activeStaff: 0, pendingInvitations: 0, shifts: 0 };

test('new agency: steps in order, none done, prerequisites explained', () => {
  const steps = setupSteps(fresh, 'HR');
  assert.deepEqual(steps.map((s) => s.key), ['prefix', 'service', 'invite', 'shift']);
  assert.ok(steps.every((s) => !s.done));
  const invite = steps.find((s) => s.key === 'invite')!;
  assert.match(invite.blockedReason ?? '', /prefix/);
  const shift = steps.find((s) => s.key === 'shift')!;
  assert.equal(shift.href, null);
  assert.match(shift.blockedReason ?? '', /service/);
  assert.equal(setupComplete(steps), false);
});

test('only HR gets a link to set the prefix', () => {
  assert.equal(setupSteps(fresh, 'HR')[0].href, '/admin');
  const mgr = setupSteps(fresh, 'MANAGER')[0];
  assert.equal(mgr.href, null);
  assert.match(mgr.blockedReason ?? '', /HR/);
});

test('steps complete from data; prerequisites clear as they are met', () => {
  const steps = setupSteps({ employeeIdPrefixSet: true, services: 1, activeStaff: 0, pendingInvitations: 2, shifts: 0 }, 'HR');
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  assert.equal(byKey.prefix.done, true);
  assert.equal(byKey.service.done, true);
  assert.equal(byKey.invite.done, false);
  assert.equal(byKey.invite.blockedReason, null);
  assert.equal(byKey.invite.note, '2 invitations sent, not yet accepted');
  assert.equal(byKey.shift.href, '/dashboard/rota?create=1');
  assert.equal(byKey.shift.blockedReason, null);

  const all = setupSteps({ employeeIdPrefixSet: true, services: 2, activeStaff: 3, pendingInvitations: 0, shifts: 5 }, 'HR');
  assert.equal(setupComplete(all), true);
});
