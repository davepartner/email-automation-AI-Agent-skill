// Product lead lifecycle: a pending purchase ("lead") becomes "paid" on purchase.
// The payday nurture applies only to still-pending leads past the initial cart window.

export const LEAD = { LEAD: 'lead', PAID: 'paid' };

/**
 * Is this a payday-eligible lead?
 * - stage is 'lead' and status 'active'
 * - it was abandoned at least `cartWindowDays` ago (so the initial 1h/24h/72h cart
 *   sequence has finished — the payday sequence must not clash with it)
 */
export function isPaydayEligible({ stage, status, abandonedAtMs, nowMs, cartWindowDays = 7 }) {
  if (stage !== LEAD.LEAD || status !== 'active') return false;
  if (abandonedAtMs == null) return false;
  return nowMs - abandonedAtMs >= cartWindowDays * 24 * 60 * 60 * 1000;
}

/**
 * Move a lead to the "paid" table. Returns a NEW object (immutable) so callers can
 * persist it; the caller then cancels the lead's scheduled emails and enrols the
 * paid-product sequences.
 */
export function moveToPaid(lead, { purchasedAtMs } = {}) {
  return {
    ...lead,
    stage: LEAD.PAID,
    status: 'purchased',
    purchasedAtMs: purchasedAtMs ?? lead.purchasedAtMs ?? Date.now(),
  };
}
