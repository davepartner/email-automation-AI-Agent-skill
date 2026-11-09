import test from 'node:test';
import assert from 'node:assert/strict';
import { isPaydayEligible, LEAD, moveToPaid } from './leads.mjs';

const day = 24 * 60 * 60 * 1000;

test('a fresh abandoned cart is not payday-eligible (cart window)', () => {
  const now = Date.now();
  assert.equal(
    isPaydayEligible({ stage: LEAD.LEAD, status: 'active', abandonedAtMs: now - 3 * day, nowMs: now }),
    false,
  );
});

test('a lead abandoned past the cart window is payday-eligible', () => {
  const now = Date.now();
  assert.equal(
    isPaydayEligible({ stage: LEAD.LEAD, status: 'active', abandonedAtMs: now - 10 * day, nowMs: now }),
    true,
  );
});

test('a paid product is never payday-eligible', () => {
  const now = Date.now();
  assert.equal(
    isPaydayEligible({ stage: LEAD.PAID, status: 'purchased', abandonedAtMs: now - 30 * day, nowMs: now }),
    false,
  );
});

test('moveToPaid returns a new paid lead and does not mutate the input', () => {
  const lead = { userId: 'u1', productId: 'A', stage: LEAD.LEAD, status: 'active' };
  const paid = moveToPaid(lead, { purchasedAtMs: 123 });
  assert.equal(paid.stage, LEAD.PAID);
  assert.equal(paid.status, 'purchased');
  assert.equal(paid.purchasedAtMs, 123);
  assert.equal(lead.stage, LEAD.LEAD); // original untouched
});
