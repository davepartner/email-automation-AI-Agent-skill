import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmailWorker,
  KIND,
  MemoryStore,
  PRIORITY,
  isWithinAllowedSendWindow,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './worker.mjs';

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
  const token = signUnsubscribeToken({ userId: 'u1', email: 'u1@example.com' }, secret);

  assert.deepEqual(verifyUnsubscribeToken(token, secret), { userId: 'u1', email: 'u1@example.com' });
  assert.equal(verifyUnsubscribeToken(`${token}x`, secret), null);
  assert.equal(verifyUnsubscribeToken(token, 'wrong-secret'), null);
  assert.equal(verifyUnsubscribeToken('garbage', secret), null);
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
