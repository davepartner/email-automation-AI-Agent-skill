import test from 'node:test';
import assert from 'node:assert/strict';
import { lastDayOfMonth, nextOccurrence, paydaySteps } from './schedule.mjs';

test('lastDayOfMonth handles normal, non-leap Feb, and leap Feb', () => {
  assert.equal(lastDayOfMonth(2026, 1), 31);
  assert.equal(lastDayOfMonth(2026, 2), 28);
  assert.equal(lastDayOfMonth(2028, 2), 29);
});

test('nextOccurrence: next 27th', () => {
  const from = Date.UTC(2026, 0, 20, 10); // Jan 20
  assert.equal(nextOccurrence(from, 27, { hour: 9 }), Date.UTC(2026, 0, 27, 9));
});

test('nextOccurrence: after the 27th rolls to next month', () => {
  const from = Date.UTC(2026, 0, 28, 10); // Jan 28
  assert.equal(nextOccurrence(from, 27, { hour: 9 }), Date.UTC(2026, 1, 27, 9));
});

test('nextOccurrence: last day of the month', () => {
  assert.equal(nextOccurrence(Date.UTC(2026, 0, 20, 10), 'last', { hour: 9 }), Date.UTC(2026, 0, 31, 9));
  assert.equal(nextOccurrence(Date.UTC(2026, 1, 15, 10), 'last', { hour: 9 }), Date.UTC(2026, 1, 28, 9));
  assert.equal(nextOccurrence(Date.UTC(2028, 1, 15, 10), 'last', { hour: 9 }), Date.UTC(2028, 1, 29, 9));
});

test('nextOccurrence: the 2nd of the next month', () => {
  const from = Date.UTC(2026, 0, 30, 10); // Jan 30
  assert.equal(nextOccurrence(from, 2, { hour: 9 }), Date.UTC(2026, 1, 2, 9));
});

test('nextOccurrence respects a UTC offset', () => {
  // from = Jan 20 08:30 UTC = 09:30 at UTC+1; the 27th at 09:00 local = 08:00 UTC
  const from = Date.UTC(2026, 0, 20, 8, 30);
  assert.equal(nextOccurrence(from, 27, { hour: 9, utcOffsetMinutes: 60 }), Date.UTC(2026, 0, 27, 8));
});

test('paydaySteps returns 27th, last, 2nd with stable ids', () => {
  const steps = paydaySteps();
  assert.deepEqual(steps.map((s) => s.schedule.day), [27, 'last', 2]);
  assert.deepEqual(steps.map((s) => s.id), ['payday-27', 'payday-last', 'payday-2']);
  assert.equal(steps.length, 3);
});

test('invalid anchors throw instead of returning null', () => {
  assert.throws(() => nextOccurrence(Date.UTC(2026, 0, 1), 0), RangeError);
  assert.throws(() => nextOccurrence(Date.UTC(2026, 0, 1), 32), RangeError);
  assert.throws(() => nextOccurrence(Date.UTC(2026, 0, 1), 'first'), RangeError);
  assert.throws(() => nextOccurrence(Date.UTC(2026, 0, 1), 'last', { hour: 24 }), RangeError);
});

test('a day past the month end clamps (31 → 28 Feb, 29 in a leap year)', () => {
  assert.equal(nextOccurrence(Date.UTC(2026, 1, 1), 31, { hour: 9 }), Date.UTC(2026, 1, 28, 9));
  assert.equal(nextOccurrence(Date.UTC(2028, 1, 1), 31, { hour: 9 }), Date.UTC(2028, 1, 29, 9));
});
