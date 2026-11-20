import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CrossSellEngine,
  CrossSellStore,
  DEFAULT_SETTINGS,
  ENROLLMENT_STATUS,
  FEEDBACK_ACTION,
  ProductSimilarityMatcher,
  buildCheckoutUrl,
  buildCoBuyMatrix,
  extractFeatures,
  keywordOverlap,
  priceTierMatches,
  signFeedbackToken,
  verifyFeedbackToken,
} from './cross-sell.mjs';

const DAY = 24 * 60 * 60 * 1000;

function catalog() {
  return [
    { id: 'corolla', title: '2016 Toyota Corolla', description: 'reliable compact sedan with great fuel economy', category_id: 'cars', tags: ['sedan', 'toyota'], price: 16000, attributes: { make: 'Toyota', body_type: 'sedan' }, features: ['38 MPG highway', 'backup camera', 'Bluetooth'] },
    { id: 'accord', title: '2015 Honda Accord', description: 'comfortable midsize sedan, well maintained', category_id: 'cars', tags: ['sedan', 'honda'], price: 16500, attributes: { make: 'Honda', body_type: 'sedan' }, features: ['36 MPG highway', 'leather seats', 'sunroof'] },
    { id: 'rav4', title: '2017 Toyota RAV4', description: 'spacious compact SUV with all-wheel drive', category_id: 'cars', tags: ['suv', 'toyota'], price: 21000, attributes: { make: 'Toyota', body_type: 'suv' }, features: ['AWD', 'roof rack', '28 MPG'] },
    { id: 'harley', title: 'Harley-Davidson Street 750', description: 'cruiser motorcycle, low miles', category_id: 'motorcycles', tags: ['cruiser', 'harley'], price: 7000, attributes: { make: 'Harley-Davidson', body_type: 'cruiser' }, features: ['749cc engine', 'chrome exhaust'] },
    { id: 'react-course', title: 'React 19 Masterclass', description: 'learn react hooks, server components and modern patterns', category_id: 'courses', tags: ['react', 'frontend'], price: 99, attributes: { topic: 'react' }, features: ['40 hours of video', 'lifetime access', 'project-based'] },
    { id: 'nextjs-course', title: 'Next.js 15 Deep Dive', description: 'master next.js app router, server actions and react server components', category_id: 'courses', tags: ['nextjs', 'frontend'], price: 120, attributes: { topic: 'nextjs' }, features: ['32 hours of video', 'certificate', 'source code'] },
    { id: 'python-course', title: 'Python for Data Science', description: 'pandas, numpy and machine learning from scratch', category_id: 'courses', tags: ['python', 'data'], price: 90, attributes: { topic: 'python' }, features: ['60 hours of video', '3 capstone projects'] },
    { id: 'no-meta', title: 'Mystery Item', description: '', category_id: null, tags: [], price: null, attributes: {} },
  ];
}

function setup(overrides = {}) {
  const products = overrides.products ?? catalog();
  const matcher = new ProductSimilarityMatcher({
    products,
    coBought: overrides.coBought ?? new Map(),
    coViewed: overrides.coViewed ?? new Map(),
  });
  // Cross-sell ships ACTIVE by default; a test can pass settings to pause it.
  const store = new CrossSellStore(overrides.settings ?? {});
  store.setUser('u1', { email: 'u1@example.com', firstName: 'Ada' });
  const engine = new CrossSellEngine({ store, matcher, now: overrides.now ?? (() => Date.now()) });
  return { matcher, store, engine, products };
}

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

test('extractFeatures prefers explicit structured fields and dedupes', () => {
  const p = { title: 'X', features: ['one', 'two', '- three', 'one'] };
  assert.deepEqual(extractFeatures(p), ['one', 'two', 'three']);
});

test('extractFeatures falls back to description sentences', () => {
  const p = { title: 'X', description: 'A comfortable sedan with great fuel economy. It has a backup camera. Well maintained.' };
  const out = extractFeatures(p);
  assert.equal(out.length, 3);
  assert.ok(out[0].includes('sedan'));
});

test('extractFeatures synthesizes from title + attributes when nothing else exists', () => {
  const p = { title: '2016 Toyota Corolla', attributes: { make: 'Toyota', body_type: 'sedan' } };
  const out = extractFeatures(p);
  assert.ok(out.length > 0);
  assert.ok(out.some((b) => b.includes('Toyota')));
});

test('extractFeatures flattens an object specifications map', () => {
  const p = { title: 'X', specifications: { engine: '2.0L', transmission: 'auto' } };
  const out = extractFeatures(p);
  assert.ok(out.includes('engine: 2.0L'));
});

// ---------------------------------------------------------------------------
// Similarity tiers
// ---------------------------------------------------------------------------

test('Tier 1: shared category/tags/price pick the same-body car over the SUV', () => {
  const { matcher, products } = setup();
  const source = products.find((p) => p.id === 'corolla');
  const best = matcher.findNextBest('corolla', { exclude: new Set() });
  assert.equal(best.id, 'accord'); // same category + sedan tag + make-family, not the RAV4
  assert.ok(matcher.score(source, best) > matcher.score(source, products.find((p) => p.id === 'rav4')));
});

test('Tier 2: keyword overlap selects the semantically similar course', () => {
  const { matcher, products } = setup();
  const source = products.find((p) => p.id === 'react-course');
  const best = matcher.findNextBest('react-course', { exclude: new Set() });
  assert.equal(best.id, 'nextjs-course'); // both mention react/server components
});

test('Tier 3: collaborative co-bought fallback wins when metadata is absent', () => {
  const coBought = buildCoBuyMatrix([
    { userId: 'a', productId: 'no-meta' },
    { userId: 'a', productId: 'harley' },
    { userId: 'b', productId: 'no-meta' },
    { userId: 'b', productId: 'harley' },
  ]);
  const { matcher } = setup({ coBought });
  const best = matcher.findNextBest('no-meta', { exclude: new Set() });
  assert.equal(best.id, 'harley');
});

test('findNextBest returns null when nothing scores above zero', () => {
  const { matcher } = setup();
  assert.equal(matcher.findNextBest('no-meta', { exclude: new Set(['harley', 'corolla', 'accord', 'rav4', 'react-course', 'nextjs-course', 'python-course']) }), null);
});

test('priceTierMatches: same tier OR ±30% price', () => {
  assert.equal(priceTierMatches({ price: 100 }, { price: 120 }), true); // +20%
  assert.equal(priceTierMatches({ price: 100 }, { price: 140 }), false); // +40%
  assert.equal(priceTierMatches({ price_tier: 'mid' }, { price_tier: 'mid' }), true);
});

test('keywordOverlap is symmetric and empty-safe', () => {
  assert.equal(keywordOverlap('react hooks components', 'react hooks server'), keywordOverlap('react hooks server', 'react hooks components'));
  assert.equal(keywordOverlap('', ''), 0);
  assert.equal(keywordOverlap('react', 'react'), 1);
});

// ---------------------------------------------------------------------------
// Admin toggle guard
// ---------------------------------------------------------------------------

test('admin toggle OFF blocks enrolment and dispatch', async () => {
  const { store, engine } = setup({ settings: { cross_sell_automation_enabled: false } });
  const res = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  assert.equal(res.enrolled, 0);
  assert.equal(res.reason, 'disabled');
  assert.equal(store.enrollments.size, 0);

  // A pre-existing scheduled row must not be dispatched while OFF.
  store.insertEnrollment({ id: 'e1', userId: 'u1', sourceProductId: 'corolla', recommendedProductId: 'accord', sequenceType: 'cross_sell', currentStep: 1, status: ENROLLMENT_STATUS.ACTIVE });
  store.scheduleRow({ id: 'e1:step-1', enrollmentId: 'e1', userId: 'u1', step: 1, dueAt: 0, productId: 'accord' });
  let sent = 0;
  const r = await engine.processDue({ now: 0, send: async () => { sent += 1; } });
  assert.equal(r.reason, 'disabled');
  assert.equal(sent, 0);
});

test('cross-sell ships ACTIVE by default; the admin toggle pauses it', async () => {
  const { store, engine } = setup();
  // No settings override → active out of the box.
  assert.equal(engine.isEnabled(), true);
  const res = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  assert.equal(res.enrolled, 1);

  // Admin pauses it → future enrolment + dispatch are blocked.
  store.settings.cross_sell_automation_enabled = false;
  assert.equal(engine.isEnabled(), false);
  const paused = engine.maybeEnrollNext({ userId: 'u2', sourceProductId: 'corolla', anchorAt: 0 });
  assert.equal(paused.enrolled, 0);
  assert.equal(paused.reason, 'disabled');
  let sent = 0;
  const r = await engine.processDue({ now: 7 * DAY, send: async () => { sent += 1; } });
  assert.equal(r.reason, 'disabled');
  assert.equal(sent, 0);
});

test('maybeEnrollNext is idempotent — replaying the completed event never double-enrols', () => {
  const { store, engine } = setup();
  const a = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  assert.equal(a.enrolled, 1);
  const replay = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 1000 });
  assert.equal(replay.enrolled, 0);
  assert.equal(replay.reason, 'duplicate');
  assert.equal(store.enrollments.size, 1);
  assert.equal(store.rows.length, 3); // still one 3-email sequence
});

test('enrollForProduct is idempotent for the same product', () => {
  const { store, engine } = setup();
  assert.equal(engine.enrollForProduct({ userId: 'u1', productId: 'rav4' }).enrolled, 1);
  assert.equal(engine.enrollForProduct({ userId: 'u1', productId: 'rav4' }).reason, 'duplicate');
  assert.equal(store.enrollments.size, 1);
});

// ---------------------------------------------------------------------------
// Cooldown + cadence
// ---------------------------------------------------------------------------

test('email 1 lands after the cooldown; steps 2 and 3 at +3 and +7 days', async () => {
  const { store, engine } = setup();
  const anchor = 1_000_000; // initial sequence "completed" here
  const res = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: anchor });
  assert.equal(res.enrolled, 1);

  const enrollment = res.enrollment;
  assert.equal(enrollment.recommendedProductId, 'accord');
  assert.equal(enrollment.currentStep, 1);
  assert.equal(enrollment.nextSendAt, anchor + 7 * DAY);

  const rows = store.rows.map((r) => ({ step: r.step, dueAt: r.dueAt }));
  assert.equal(rows[0].dueAt, anchor + 7 * DAY); // day 7
  assert.equal(rows[1].dueAt, anchor + 10 * DAY); // day 10
  assert.equal(rows[2].dueAt, anchor + 14 * DAY); // day 14

  // Advance through all three sends, then completion.
  let sent = 0;
  await engine.processDue({ now: anchor + 7 * DAY, send: async () => { sent += 1; } });
  assert.equal(sent, 1);
  assert.equal(enrollment.currentStep, 2);

  await engine.processDue({ now: anchor + 10 * DAY, send: async () => { sent += 1; } });
  assert.equal(enrollment.currentStep, 3);

  await engine.processDue({ now: anchor + 14 * DAY, send: async () => { sent += 1; } });
  assert.equal(sent, 3);
  assert.equal(enrollment.status, ENROLLMENT_STATUS.COMPLETED);
  assert.equal(store.completed.get('u1').has('accord'), true);
});

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

test('purchased, completed and disliked products are never recommended', () => {
  const { engine } = setup();
  storePurchaseAndFlags(engine.store);
  // corolla is the source; the only car-like candidate is accord, but it is excluded
  // in every way, so the matcher must pick a different product or none.
  const exclude = engine.exclusionsFor('u1');
  assert.ok(exclude.has('accord'));
  assert.ok(exclude.has('rav4')); // completed
  assert.ok(exclude.has('harley')); // disliked
});

test('dislike blacklists the recommended product for that user only', () => {
  const { store, engine } = setup();
  const a = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  store.setUser('u2', { email: 'u2@example.com', firstName: 'Bo' });
  engine.dislike(a.enrollment.id, { now: 0 });
  assert.equal(store.isDisliked('u1', 'accord'), true);
  assert.equal(store.isDisliked('u2', 'accord'), false);
});

function storePurchaseAndFlags(store) {
  store.markPurchased('u1', 'accord');
  store.markCompleted('u1', 'rav4');
  store.recordFeedback('u1', 'harley', FEEDBACK_ACTION.DISLIKE);
}

// ---------------------------------------------------------------------------
// Like / Dislike handlers
// ---------------------------------------------------------------------------

test('like marks liked, stops remaining emails, and returns a UTM redirect', () => {
  const { store, engine, matcher } = setup();
  const a = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  const enrollment = a.enrollment;
  const product = matcher.get('accord');
  product.checkout_url = 'https://shop.example.com/buy/accord';

  const res = engine.like(enrollment.id, { now: 0, utm: { utm_campaign: 'test' } });

  assert.equal(res.ok, true);
  assert.equal(enrollment.status, ENROLLMENT_STATUS.LIKED);
  assert.equal(res.cancelled, 3); // all three scheduled rows stopped
  assert.ok(res.redirect.startsWith('https://shop.example.com/buy/accord?'));
  assert.ok(res.redirect.includes('utm_source=email'));
  assert.ok(res.redirect.includes('utm_campaign=test'));
  assert.equal(store.feedback.get('u1').liked.has('accord'), true);
  // No remaining scheduled rows.
  assert.equal(store.rows.filter((r) => r.status === 'scheduled').length, 0);
});

test('dislike halts the current sequence and re-enrolls the next similar product after a delay', () => {
  const { store, engine } = setup();
  const a = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  const now = 5_000_000;
  const res = engine.dislike(a.enrollment.id, { now });

  assert.equal(res.ok, true);
  assert.equal(a.enrollment.status, ENROLLMENT_STATUS.DISLIKED);
  assert.equal(res.cancelled, 3);
  assert.equal(store.isDisliked('u1', 'accord'), true);

  // A fresh sequence exists for the next-best product, scheduled 24h out.
  assert.equal(res.reEnrolled, 1);
  const next = res.nextEnrollment;
  assert.ok(next.id !== a.enrollment.id);
  assert.equal(next.status, ENROLLMENT_STATUS.ACTIVE);
  assert.equal(next.nextSendAt, now + 24 * 60 * 60 * 1000);
  // It must NOT be the disliked product.
  assert.notEqual(next.recommendedProductId, 'accord');
});

test('dislike with the toggle OFF records feedback but does not re-enroll', () => {
  const { store, engine } = setup({ settings: { cross_sell_automation_enabled: false } });
  // Force an enrollment directly (bypassing the toggle) to simulate a prior active sequence.
  const e = {
    id: 'e1', userId: 'u1', sourceProductId: 'corolla', recommendedProductId: 'accord',
    sequenceType: 'cross_sell', currentStep: 1, status: ENROLLMENT_STATUS.ACTIVE,
  };
  store.insertEnrollment(e);
  store.scheduleRow({ id: 'e1:step-1', enrollmentId: 'e1', userId: 'u1', step: 1, dueAt: 0, productId: 'accord' });

  const res = engine.dislike('e1', { now: 0 });
  assert.equal(res.ok, true);
  assert.equal(store.isDisliked('u1', 'accord'), true);
  assert.equal(res.reEnrolled, 0);
});

// ---------------------------------------------------------------------------
// Cap + no-eligible
// ---------------------------------------------------------------------------

test('max cross-sell cap per user is enforced', () => {
  const { engine } = setup({ settings: { cross_sell_max_per_user: 1 } });
  const a = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  assert.equal(a.enrolled, 1);
  const b = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 1000 });
  assert.equal(b.enrolled, 0);
  assert.equal(b.reason, 'cap');
});

test('no eligible product returns a clean reason', () => {
  const products = [
    { id: 'only', title: 'Only Product', description: 'x', category_id: 'x', tags: [], price: 10, attributes: {} },
  ];
  const { engine } = setup({ products });
  const res = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'only', anchorAt: 0 });
  assert.equal(res.enrolled, 0);
  assert.equal(res.reason, 'no-eligible');
});

// ---------------------------------------------------------------------------
// Signed feedback tokens
// ---------------------------------------------------------------------------

test('signed feedback tokens verify; tampering, wrong secret and expiry are rejected', () => {
  const secret = 's3cr3t';
  const now = Date.UTC(2026, 0, 1);
  const token = signFeedbackToken({ userId: 'u1', enrollmentId: 'e1', action: 'like' }, secret, { now });

  const payload = verifyFeedbackToken(token, secret, { now: now + 1000 });
  assert.equal(payload.userId, 'u1');
  assert.equal(payload.enrollmentId, 'e1');
  assert.equal(payload.action, 'like');
  assert.ok(payload.exp > now);
  assert.ok(payload.jti);

  assert.equal(verifyFeedbackToken(`${token}x`, secret, { now }), null);
  assert.equal(verifyFeedbackToken(token, 'wrong-secret', { now }), null);
  assert.equal(verifyFeedbackToken('garbage', secret, { now }), null);
  assert.equal(verifyFeedbackToken(token, secret, { now: now + 31 * 24 * 3600 * 1000 }), null); // expired
  assert.equal(verifyFeedbackToken(token, secret, { now, isUsed: () => true }), null); // replayed
});

test('signFeedbackToken rejects unknown actions and missing enrollmentId', () => {
  assert.throws(() => signFeedbackToken({ enrollmentId: 'e1', action: 'banana' }, 's'), RangeError);
  assert.throws(() => signFeedbackToken({ action: 'like' }, 's'), RangeError);
  assert.throws(() => signFeedbackToken({ enrollmentId: 'e1', action: 'like' }, 's', { expiresInMs: 0 }), RangeError);
});

test('buildCheckoutUrl defaults and overrides UTM params', () => {
  assert.equal(
    buildCheckoutUrl({ id: 'p1', checkout_url: 'https://x.com/buy' }),
    'https://x.com/buy?utm_source=email&utm_medium=cross-sell&utm_campaign=cross-sell-like',
  );
  assert.ok(buildCheckoutUrl({ id: 'p1' }, { utm_campaign: 'custom' }).includes('utm_campaign=custom'));
});

// ---------------------------------------------------------------------------
// User-profile surface: list / stop one / stop all / add / self-service opt-out
// ---------------------------------------------------------------------------

test('listSequences groups active, previous and pending with product titles', () => {
  const { store, engine } = setup();
  const a = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  store.insertEnrollment({
    id: 'e2', userId: 'u1', sourceProductId: 'corolla', recommendedProductId: 'rav4',
    sequenceType: 'cross_sell', currentStep: 3, status: ENROLLMENT_STATUS.COMPLETED, nextSendAt: 0,
  });

  const view = engine.listSequences('u1');
  assert.equal(view.active.length, 1);
  assert.equal(view.active[0].productId, 'accord');
  assert.equal(view.active[0].productTitle, '2015 Honda Accord');
  assert.equal(view.previous.length, 1);
  assert.equal(view.previous[0].productId, 'rav4');
  assert.equal(view.previous[0].status, ENROLLMENT_STATUS.COMPLETED);
  assert.equal(view.pending.length, 3); // the 3 still-scheduled rows of the active sequence
  assert.equal(view.pending[0].productTitle, '2015 Honda Accord');
});

test('stopSequence (admin) stops one sequence and its rows, leaving others', () => {
  const { store, engine } = setup();
  const a = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  const b = engine.enrollForProduct({ userId: 'u1', productId: 'rav4', anchorAt: 1000 });
  assert.equal(b.enrolled, 1);

  const res = engine.stopSequence(a.enrollment.id, { actor: 'admin' });
  assert.equal(res.ok, true);
  assert.equal(res.stopped, 1);
  assert.equal(res.cancelled, 3);
  assert.equal(a.enrollment.status, ENROLLMENT_STATUS.CANCELLED);
  assert.equal(a.enrollment.cancelReason, 'admin');
  assert.equal(b.enrollment.status, ENROLLMENT_STATUS.ACTIVE); // untouched
});

test('stopSequence on a non-active sequence is a no-op', () => {
  const { store, engine } = setup();
  store.insertEnrollment({
    id: 'e2', userId: 'u1', sourceProductId: 'corolla', recommendedProductId: 'rav4',
    sequenceType: 'cross_sell', currentStep: 3, status: ENROLLMENT_STATUS.COMPLETED,
  });
  assert.equal(engine.stopSequence('e2').ok, false);
  assert.equal(engine.stopSequence('e2').reason, 'not-active');
});

test('stopAllSequences (admin) stops every active sequence without flipping consent', () => {
  const { store, engine } = setup();
  engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  engine.enrollForProduct({ userId: 'u1', productId: 'rav4', anchorAt: 0 });

  const res = engine.stopAllSequences('u1', { actor: 'admin' });
  assert.equal(res.stopped, 2);
  assert.equal(res.cancelled, 6); // 3 rows each
  assert.equal(store.isPromotionallyOptedOut('u1'), false); // admin stop does NOT flip consent
  assert.equal(engine.listSequences('u1').active.length, 0);
});

test('stopPromotionalEmail (user) stops all and blocks future enrolment', () => {
  const { store, engine } = setup();
  engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });

  const res = engine.stopPromotionalEmail('u1');
  assert.equal(res.ok, true);
  assert.equal(res.stopped, 1);
  assert.equal(res.promotionalOptOut, true);
  assert.equal(store.isPromotionallyOptedOut('u1'), true);

  // future automatic enrolment is blocked
  const b = engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 999_999 });
  assert.equal(b.enrolled, 0);
  assert.equal(b.reason, 'opted-out');
  // admin add is also blocked by the opt-out
  assert.equal(engine.enrollForProduct({ userId: 'u1', productId: 'rav4' }).reason, 'opted-out');
});

test('processDue cancels scheduled rows after a promotional opt-out', async () => {
  const { store, engine } = setup();
  engine.maybeEnrollNext({ userId: 'u1', sourceProductId: 'corolla', anchorAt: 0 });
  store.setPromotionalOptOut('u1', true);

  let sent = 0;
  await engine.processDue({ now: 7 * DAY, send: async () => { sent += 1; } });
  assert.equal(sent, 0);
  assert.equal(store.rows[0].status, 'cancelled');
  assert.equal(store.rows[0].reason, 'promotional-optout');
});

test('enrollForProduct respects toggle, cap, purchased and disliked', () => {
  const { store, engine } = setup({ settings: { cross_sell_max_per_user: 1 } });
  store.markPurchased('u1', 'rav4');
  assert.equal(engine.enrollForProduct({ userId: 'u1', productId: 'rav4' }).reason, 'purchased');
  store.recordFeedback('u1', 'accord', FEEDBACK_ACTION.DISLIKE);
  assert.equal(engine.enrollForProduct({ userId: 'u1', productId: 'accord' }).reason, 'disliked');
  assert.equal(engine.enrollForProduct({ userId: 'u1', productId: 'nope' }).reason, 'not-found');

  const ok = engine.enrollForProduct({ userId: 'u1', productId: 'react-course', anchorAt: 0 });
  assert.equal(ok.enrolled, 1);
  assert.equal(ok.enrollment.recommendedProductId, 'react-course');
  assert.equal(ok.enrollment.sourceProductId, null); // admin-initiated has no abandonment source

  assert.equal(engine.enrollForProduct({ userId: 'u1', productId: 'python-course' }).reason, 'cap');
});

test('enrollForProduct is blocked while the toggle is OFF', () => {
  const { engine } = setup({ settings: { cross_sell_automation_enabled: false } });
  assert.equal(engine.enrollForProduct({ userId: 'u1', productId: 'accord' }).reason, 'disabled');
});

test('searchProduct matches by exact id or title substring', () => {
  const { engine } = setup();
  assert.deepEqual(engine.searchProduct('corolla').map((p) => p.id), ['corolla']);
  assert.deepEqual(engine.searchProduct('honda').map((p) => p.id), ['accord']);
  assert.deepEqual(engine.searchProduct(''), []);
  assert.deepEqual(engine.searchProduct('zzz-does-not-exist'), []);
});
