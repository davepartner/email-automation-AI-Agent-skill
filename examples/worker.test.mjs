import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  EmailWorker,
  KIND,
  MemoryStore,
  PRIORITY,
  applyUnsubscribe,
  isWithinAllowedSendWindow,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './worker.mjs';
import { nextOccurrence, paydaySteps } from './schedule.mjs';

function setup(opts = {}) {
  const store = new MemoryStore();
  const sent = [];
  const worker = new EmailWorker({
    store,
    sendEmail: async (m) => { sent.push(m); },
    now: opts.now ?? (() => 12 * 3600 * 1000), // 12:00 UTC by default (inside 08–21)
    maxPerDay: opts.maxPerDay ?? 5,
    maxDeferrals: opts.maxDeferrals ?? 3,
    maxAttempts: opts.maxAttempts ?? 3,
    sendWindow: opts.sendWindow ?? { start: 8, end: 21 },
    isEligible: opts.isEligible ?? (() => true),
  });
  store.registerSequence('welcome', { kind: KIND.MARKETING, priority: PRIORITY.welcome });
  store.registerSequence('cart', { kind: KIND.MARKETING, priority: PRIORITY.cart });
  store.registerSequence('win_back', { kind: KIND.MARKETING, priority: PRIORITY.win_back });
  store.registerSequence('verify', { kind: KIND.TRANSACTIONAL, priority: 9 });
  store.registerSequence('payday_reengage', { kind: KIND.NURTURE, priority: PRIORITY.payday });
  store.registerSequence('post_purchase', { kind: KIND.MARKETING, priority: PRIORITY.purchase });
  return { store, worker, sent };
}

test('processDue is idempotent — running twice sends once', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }], at: 0 });

  const r1 = await worker.processDue();
  const r2 = await worker.processDue();

  assert.equal(sent.length, 1);
  assert.equal(r1.sent, 1);
  assert.equal(r2.sent, 0);
});

test('stop condition cancels instead of sending (never email a buyer)', async () => {
  const { store, worker, sent } = setup({ isEligible: () => false });
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'cart', stepDefs: [{ id: 's1', delayMinutes: 0, stopCondition: 'purchased' }], at: 0 });

  const r = await worker.processDue();
  assert.equal(sent.length, 0);
  assert.equal(r.cancelled, 1);
});

test('frequency cap defers a second marketing email in the same day', async () => {
  const { store, worker } = setup({ maxPerDay: 1 });
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }, { id: 's2', delayMinutes: 0 }], at: 0 });

  const r = await worker.processDue();
  assert.equal(r.sent, 1);
  assert.equal(r.deferred, 1);
});

test('reaper recovers stuck rows but caps retries → failed', () => {
  const { store, worker } = setup({ maxAttempts: 2 });
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }], at: 0 });
  const row = [...store.rows.values()][0];

  store.claim(row.id, 0);
  assert.equal(worker.reapStuck(60_000).reaped, 1); // attempts 0 → 1
  store.claim(row.id, 0);
  assert.equal(worker.reapStuck(60_000).reaped, 1); // attempts 1 → 2
  store.claim(row.id, 0);
  assert.equal(worker.reapStuck(60_000).failed, 1); // attempts 2 >= cap → failed
  assert.equal(row.status, 'failed');
});

test('allowed send window handles normal and wrap-around hours', () => {
  assert.equal(isWithinAllowedSendWindow(12, 8, 21), true);
  assert.equal(isWithinAllowedSendWindow(23, 8, 21), false);
  assert.equal(isWithinAllowedSendWindow(2, 22, 6), true);
});

test('marketing is cancelled without consent; transactional still sends', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com', consentMarketing: false });

  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }], at: 0 });
  const r1 = await worker.processDue();
  assert.equal(r1.cancelled, 1);
  assert.equal(sent.length, 0);

  worker.enroll({ userId: 'u1', enrollmentId: 'e2', sequenceKey: 'verify', stepDefs: [{ id: 'v1', delayMinutes: 0 }], at: 0 });
  const r2 = await worker.processDue();
  assert.equal(r2.sent, 1);
  assert.equal(sent.length, 1);
});

test('a suppressed (unsubscribed) user gets no marketing email', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  store.suppress('u1@example.com', 'unsubscribed');
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }], at: 0 });

  const r = await worker.processDue();
  assert.equal(r.cancelled, 1);
  assert.equal(sent.length, 0);
});

test('holdout users receive no marketing email', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  const scheduled = worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }], at: 0, group: 'holdout' });

  assert.equal(scheduled, 0);
  await worker.processDue();
  assert.equal(sent.length, 0);
});

test('a higher-priority marketing sequence wins; lower one is skipped/cancelled', async () => {
  const { store, worker } = setup();

  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'cart', stepDefs: [{ id: 'c1', delayMinutes: 60 }], at: 0 });
  const skipped = worker.enroll({ userId: 'u1', enrollmentId: 'e2', sequenceKey: 'win_back', stepDefs: [{ id: 'w1', delayMinutes: 60 }], at: 0 });
  assert.equal(skipped, 0);

  store.setUser('u2', { email: 'u2@example.com' });
  worker.enroll({ userId: 'u2', enrollmentId: 'e3', sequenceKey: 'win_back', stepDefs: [{ id: 'w2', delayMinutes: 60 }], at: 0 });
  worker.enroll({ userId: 'u2', enrollmentId: 'e4', sequenceKey: 'cart', stepDefs: [{ id: 'c2', delayMinutes: 60 }], at: 0 });

  const u2 = [...store.rows.values()].filter((r) => r.userId === 'u2');
  assert.equal(u2.find((r) => r.sequenceKey === 'win_back').status, 'cancelled');
  assert.equal(u2.find((r) => r.sequenceKey === 'cart').status, 'scheduled');
});

test('admin per-step exclusion cancels that email only', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'cart', stepDefs: [{ id: 's1', delayMinutes: 0 }, { id: 's2', delayMinutes: 0 }], at: 0 });
  store.excludeStep('u1', 's1');

  const r = await worker.processDue();
  assert.equal(sent.length, 1);
  const excluded = [...store.rows.values()].find((r2) => r2.stepId === 's1');
  assert.equal(excluded.status, 'cancelled');
  assert.equal(excluded.reason, 'admin-excluded');
});

test('quiet hours use the user timezone; outside window is cancelled at max deferrals', async () => {
  const { store, worker, sent } = setup({ maxDeferrals: 0 });
  // 12:00 UTC + 660 min (11h) = 23:00 local → outside 08–21
  store.setUser('u1', { email: 'u1@example.com', timezoneOffsetMinutes: 660 });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }], at: 0 });

  const r = await worker.processDue();
  assert.equal(sent.length, 0);
  assert.equal(r.cancelled, 1);
  assert.match([...store.rows.values()][0].reason, /quiet-hours/);
});

test('repeated deferrals are capped and then cancelled', async () => {
  let clock = 12 * 3600 * 1000;
  const { store, worker } = setup({ maxPerDay: 1, maxDeferrals: 1, now: () => clock });
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }, { id: 's2', delayMinutes: 0 }], at: 0 });

  const r1 = await worker.processDue();
  assert.equal(r1.sent, 1);
  assert.equal(r1.deferred, 1);

  clock += 2 * 3600 * 1000; // past the 1h reschedule
  const r2 = await worker.processDue();
  assert.equal(r2.cancelled, 1);
});

test('signed unsubscribe tokens verify; tampering and wrong secret are rejected', () => {
  const secret = 's3cr3t';
  const now = Date.UTC(2026, 0, 1);
  const token = signUnsubscribeToken({ userId: 'u1', email: 'u1@example.com' }, secret, { now });

  const payload = verifyUnsubscribeToken(token, secret, { now: now + 1000 });
  assert.equal(payload.userId, 'u1');
  assert.equal(payload.email, 'u1@example.com');
  assert.equal(payload.scope, 'all'); // scope is never implicit
  assert.ok(payload.exp > now);
  assert.ok(payload.jti);
  assert.equal(verifyUnsubscribeToken(`${token}x`, secret, { now }), null);
  assert.equal(verifyUnsubscribeToken(token, 'wrong-secret', { now }), null);
  assert.equal(verifyUnsubscribeToken('garbage', secret, { now }), null);
});

test('unsubscribe tokens expire, are single-use, and refuse a legacy unscoped payload', () => {
  const secret = 's3cr3t';
  const now = Date.UTC(2026, 0, 1);
  const token = signUnsubscribeToken(
    { userId: 'u1', sequenceKey: 'payday_reengage', productId: 'A', scope: 'product' },
    secret,
    { now, expiresInMs: 7 * 24 * 3600 * 1000 },
  );

  assert.equal(verifyUnsubscribeToken(token, secret, { now: now + 1000 }).scope, 'product');
  assert.equal(verifyUnsubscribeToken(token, secret, { now: now + 8 * 24 * 3600 * 1000 }), null); // expired
  assert.equal(verifyUnsubscribeToken(token, secret, { now: now + 1000, isUsed: () => true }), null); // replayed

  // A well-signed token that predates scopes must not be treated as "all".
  const legacyBody = Buffer.from(JSON.stringify({ userId: 'u1', email: 'u1@example.com' })).toString('base64url');
  const legacySig = createHmac('sha256', secret).update(legacyBody).digest('base64url');
  assert.equal(verifyUnsubscribeToken(`${legacyBody}.${legacySig}`, secret, { now }), null);

  assert.throws(() => signUnsubscribeToken({ scope: 'product', userId: 'u1' }, secret), RangeError);
  assert.throws(() => signUnsubscribeToken({ userId: 'u1' }, secret, { expiresInMs: 0 }), RangeError);
});

test('applyUnsubscribe honours the token scope and cancels only that scope', async () => {
  const { store, worker } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'p1', delayMinutes: 60 }], at: 0, productId: 'A' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e2', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'p2', delayMinutes: 60 }], at: 0, productId: 'B' });

  const res = applyUnsubscribe(store, { scope: 'product', userId: 'u1', sequenceKey: 'payday_reengage', productId: 'A' });

  assert.equal(res.scope, 'product');
  assert.equal(res.cancelled, 1);
  assert.equal(store.isOptedOut('u1', 'payday_reengage', 'A'), true);
  assert.equal(store.isOptedOut('u1', 'payday_reengage', 'B'), false);
  assert.equal(store.isSuppressed('u1@example.com'), false); // not a global opt-out
});

test('erasing a user removes their scheduled rows and sent log', async () => {
  const { store, worker } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0 }], at: 0 });
  await worker.processDue();
  assert.equal(store.sent.length, 1);

  store.eraseUser('u1');
  assert.equal(store.sent.length, 0);
  assert.equal([...store.rows.values()].filter((r) => r.userId === 'u1').length, 0);
  assert.equal(store.emailOf('u1'), null);
});

test('non-email channels require explicit opt-in', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0, channel: 'push' }], at: 0 });

  const r = await worker.processDue();
  assert.equal(r.cancelled, 1);
  assert.equal(sent.length, 0);
  assert.match([...store.rows.values()][0].reason, /no-channel-consent/);
});

test('an opted-in push step is sent on the push channel', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  store.setChannelConsent('u1', 'push', true);
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0, channel: 'push' }], at: 0 });

  const r = await worker.processDue();
  assert.equal(r.sent, 1);
  assert.equal(sent[0].channel, 'push');
});

test('a suppressed channel is cancelled', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  store.setChannelConsent('u1', 'sms', true);
  store.suppressChannel('u1', 'sms', 'opted-out');
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'welcome', stepDefs: [{ id: 's1', delayMinutes: 0, channel: 'sms' }], at: 0 });

  const r = await worker.processDue();
  assert.equal(r.cancelled, 1);
  assert.equal(sent.length, 0);
  assert.match([...store.rows.values()][0].reason, /channel-suppressed/);
});

test('a nurture (payday) sequence can run alongside a promotional sequence', () => {
  const { store, worker } = setup();
  store.setUser('u1', { email: 'u1@example.com' });

  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'cart', stepDefs: [{ id: 'c1', delayMinutes: 60 }], at: 0 });
  const n = worker.enroll({ userId: 'u1', enrollmentId: 'e2', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'p1', delayMinutes: 60 }], at: 0, productId: 'A' });

  assert.equal(n, 1);
  const scheduled = [...store.rows.values()].filter((r) => r.userId === 'u1' && r.status === 'scheduled');
  assert.ok(scheduled.some((r) => r.sequenceKey === 'cart'));
  assert.ok(scheduled.some((r) => r.sequenceKey === 'payday_reengage'));
});

test('a per-product opt-out cancels only that product’s sequence', async () => {
  const { store, worker, sent } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'p1', delayMinutes: 0 }], at: 0, productId: 'A' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e2', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'p2', delayMinutes: 0 }], at: 0, productId: 'B' });
  store.optOut('u1', 'payday_reengage', 'A');

  const r = await worker.processDue();
  assert.equal(r.sent, 1); // B still goes
  const a = [...store.rows.values()].find((x) => x.productId === 'A');
  assert.equal(a.status, 'cancelled');
  assert.equal(a.reason, 'sequence-optout');
});

test('a sequence-wide opt-out (productId null) blocks every product', async () => {
  const { store, worker } = setup();
  store.setUser('u1', { email: 'u1@example.com' });
  worker.enroll({ userId: 'u1', enrollmentId: 'e1', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'p1', delayMinutes: 0 }], at: 0, productId: 'A' });
  store.optOut('u1', 'payday_reengage', null);

  const r = await worker.processDue();
  assert.equal(r.cancelled, 1);
});

test('a calendar step schedules the next occurrence (the 27th)', () => {
  const at = Date.UTC(2026, 0, 20, 10); // Jan 20
  const { store, worker } = setup({ now: () => at });
  store.setUser('u1', { email: 'u1@example.com' });

  worker.enroll({
    userId: 'u1',
    enrollmentId: 'e1',
    sequenceKey: 'payday_reengage',
    stepDefs: [{ id: 'p1', schedule: { type: 'calendar', day: 27, hour: 9 } }],
    at,
    productId: 'A',
  });

  const row = [...store.rows.values()][0];
  assert.equal(row.dueAt, Date.UTC(2026, 0, 27, 9));
});

test('calendar steps are sequential and monotonic for any enrolment date', () => {
  const enrolDates = [
    Date.UTC(2026, 0, 1, 10), // 1 Jan
    Date.UTC(2026, 0, 26, 10), // day before the 27th
    Date.UTC(2026, 0, 27, 10), // on the 27th, after the send hour
    Date.UTC(2026, 0, 31, 10), // on the last day
    Date.UTC(2026, 1, 10, 10), // February
    Date.UTC(2028, 1, 10, 10), // leap February
    Date.UTC(2026, 11, 30, 10), // year boundary
  ];

  for (const at of enrolDates) {
    const { store, worker } = setup({ now: () => at });
    store.setUser('u1', { email: 'u1@example.com' });
    worker.enroll({
      userId: 'u1',
      enrollmentId: 'e1',
      sequenceKey: 'payday_reengage',
      stepDefs: paydaySteps(),
      at,
      productId: 'A',
    });

    const due = [...store.rows.values()].map((r) => r.dueAt).sort((a, b) => a - b);
    assert.equal(due.length, 3);
    assert.ok(due[0] < due[1] && due[1] < due[2], `out of order for ${new Date(at).toISOString()}`);
    // and the labels still read 27th → last → 2nd
    const local = (ms) => new Date(ms).getUTCDate();
    assert.equal(local(due[0]), 27);
    assert.equal(local(due[2]), 2);
  }
});

test('calendar steps respect the user’s UTC offset (09:00 local, not 09:00 UTC)', () => {
  const at = Date.UTC(2026, 0, 20, 10);
  const { store, worker } = setup({ now: () => at });
  store.setUser('u1', { email: 'u1@example.com', timezoneOffsetMinutes: 60 }); // UTC+1

  worker.enroll({
    userId: 'u1',
    enrollmentId: 'e1',
    sequenceKey: 'payday_reengage',
    stepDefs: [{ id: 'p1', schedule: { type: 'calendar', day: 27, hour: 9 } }],
    at,
    productId: 'A',
  });

  const row = [...store.rows.values()][0];
  assert.equal(row.dueAt, Date.UTC(2026, 0, 27, 8)); // 09:00 at UTC+1
});

test('the cap sends the higher-priority email first; a blocked calendar email is missed', async () => {
  const sendAt = Date.UTC(2026, 0, 27, 12); // the 27th, 12:00
  const { store, worker, sent } = setup({ maxPerDay: 1, now: () => sendAt });
  store.setUser('u1', { email: 'u1@example.com' });

  // Enrol the payday (lower priority) FIRST, to prove ordering is not insertion order.
  worker.enroll({
    userId: 'u1',
    enrollmentId: 'e1',
    sequenceKey: 'payday_reengage',
    stepDefs: [{ id: 'p1', schedule: { type: 'calendar', day: 27, hour: 12 } }],
    at: Date.UTC(2026, 0, 26, 12),
    productId: 'A',
  });
  worker.enroll({
    userId: 'u1',
    enrollmentId: 'e2',
    sequenceKey: 'cart',
    stepDefs: [{ id: 'c1', delayMinutes: 0 }],
    at: sendAt,
  });

  const r = await worker.processDue();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].stepId, 'c1'); // the cart reminder wins the cap
  const payday = [...store.rows.values()].find((x) => x.stepId === 'p1');
  assert.equal(payday.status, 'missed'); // date-anchored → missed, not sent a day late
  assert.match(payday.reason, /frequency-cap/);
  assert.equal(r.missed, 1);
});

test('a calendar step before the send window defers to the window start the same day', async () => {
  const sendAt = Date.UTC(2026, 0, 27, 6, 5); // 06:05 local, window starts 08:00
  const { store, worker } = setup({ now: () => sendAt });
  store.setUser('u1', { email: 'u1@example.com' });

  worker.enroll({
    userId: 'u1',
    enrollmentId: 'e1',
    sequenceKey: 'payday_reengage',
    stepDefs: [{ id: 'p1', schedule: { type: 'calendar', day: 27, hour: 6 } }],
    at: Date.UTC(2026, 0, 26, 12),
    productId: 'A',
  });

  const r = await worker.processDue();
  const row = [...store.rows.values()][0];
  assert.equal(r.deferred, 1);
  assert.equal(row.status, 'scheduled');
  assert.equal(row.dueAt, Date.UTC(2026, 0, 27, 8)); // 08:00 local, same date
});

test('holdout applies to nurture sequences at enrolment', () => {
  const { store, worker } = setup();
  store.setUser('u1', { email: 'u1@example.com' });

  const n = worker.enroll({
    userId: 'u1',
    enrollmentId: 'e1',
    sequenceKey: 'payday_reengage',
    stepDefs: [{ id: 'p1', delayMinutes: 0 }],
    at: 0,
    group: 'holdout',
    productId: 'A',
  });

  assert.equal(n, 0);
  assert.equal([...store.rows.values()].length, 0);
});

test('a purchase cancels that product’s reminders, moves the lead to paid and enrols the paid sequence', () => {
  const at = Date.UTC(2026, 0, 1, 10);
  const { store, worker } = setup({ now: () => at });
  store.setUser('u1', { email: 'u1@example.com' });
  store.setLead('u1', 'A', { userId: 'u1', productId: 'A', stage: 'lead', status: 'active' });
  store.setLead('u1', 'B', { userId: 'u1', productId: 'B', stage: 'lead', status: 'active' });

  worker.enroll({ userId: 'u1', enrollmentId: 'eA', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'a1', delayMinutes: 60 }], at, productId: 'A' });
  worker.enroll({ userId: 'u1', enrollmentId: 'eB', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'b1', delayMinutes: 60 }], at, productId: 'B' });

  const purchasedAt = Date.UTC(2026, 0, 10, 10);
  const res = worker.handlePurchase({
    userId: 'u1',
    productId: 'A',
    purchasedAt,
    paidSequences: [{ sequenceKey: 'post_purchase', stepDefs: [{ id: 'r1', delayMinutes: 0 }] }],
  });

  assert.deepEqual(res, { moved: true, cancelled: 1, enrolled: 1 });
  assert.equal(store.getLead('u1', 'A').stage, 'paid');
  assert.equal(store.getLead('u1', 'A').purchasedAtMs, purchasedAt);

  const rows = [...store.rows.values()];
  assert.equal(rows.find((r) => r.stepId === 'a1').status, 'cancelled');
  assert.equal(rows.find((r) => r.stepId === 'a1').reason, 'purchased');
  assert.equal(rows.find((r) => r.stepId === 'b1').status, 'scheduled'); // other product untouched

  const paid = rows.find((r) => r.sequenceKey === 'post_purchase');
  assert.equal(paid.status, 'scheduled');
  assert.equal(paid.productId, 'A'); // paid sequences are product-scoped
});

test('replaying a purchase is a no-op (idempotent), even before the paid email sends', () => {
  const at = Date.UTC(2026, 0, 1, 10);
  const { store, worker } = setup({ now: () => at });
  store.setUser('u1', { email: 'u1@example.com' });
  store.setLead('u1', 'A', { userId: 'u1', productId: 'A', stage: 'lead', status: 'active' });
  worker.enroll({ userId: 'u1', enrollmentId: 'eA', sequenceKey: 'payday_reengage', stepDefs: [{ id: 'a1', delayMinutes: 60 }], at, productId: 'A' });

  const args = {
    userId: 'u1',
    productId: 'A',
    purchasedAt: Date.UTC(2026, 0, 10, 10),
    paidSequences: [{ sequenceKey: 'post_purchase', stepDefs: [{ id: 'r1', delayMinutes: 0 }] }],
  };
  worker.handlePurchase(args);
  const replay = worker.handlePurchase(args);

  assert.deepEqual(replay, { moved: false, cancelled: 0, enrolled: 0 });
  const paidRows = [...store.rows.values()].filter((r) => r.sequenceKey === 'post_purchase');
  assert.equal(paidRows.length, 1); // never double-enrolled
});

test('local hour handles half-hour offsets (e.g. UTC+05:30)', () => {
  const { worker } = setup();
  // 12:00 UTC + 330 min = 17:30 → hour 17
  assert.equal(worker.localHour(12 * 3600 * 1000, 330), 17);
  // 23:30 UTC + 330 min = 05:00 next day → hour 5
  assert.equal(worker.localHour(23.5 * 3600 * 1000, 330), 5);
});

test('an invalid calendar anchor throws instead of scheduling “now”', () => {
  const { store, worker } = setup();
  store.setUser('u1', { email: 'u1@example.com' });

  assert.throws(
    () =>
      worker.enroll({
        userId: 'u1',
        enrollmentId: 'e1',
        sequenceKey: 'payday_reengage',
        stepDefs: [{ id: 'p1', schedule: { type: 'calendar', day: 32, hour: 9 } }],
        at: 0,
        productId: 'A',
      }),
    RangeError,
  );
  assert.throws(() => nextOccurrence(Date.now(), 'first'), RangeError);
});

test('a calendar email whose date passed while the worker was down is missed, not sent late', async () => {
  let clock = Date.UTC(2026, 0, 20, 10);
  const { store, worker, sent } = setup({ now: () => clock });
  store.setUser('u1', { email: 'u1@example.com' });

  worker.enroll({
    userId: 'u1',
    enrollmentId: 'e1',
    sequenceKey: 'payday_reengage',
    stepDefs: [{ id: 'p1', schedule: { type: 'calendar', day: 27, hour: 9 } }],
    at: clock,
    productId: 'A',
  });

  clock = Date.UTC(2026, 0, 28, 6); // the worker wakes on the 28th, before the window
  const r = await worker.processDue();

  assert.equal(sent.length, 0);
  assert.equal(r.missed, 1);
  const row = [...store.rows.values()][0];
  assert.equal(row.status, 'missed');
  assert.match(row.reason, /stale-date/);
});
