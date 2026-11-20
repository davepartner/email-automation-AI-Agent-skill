import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// Reference implementation for the "intelligent cross-sell" upgrade.
// Zero runtime deps (node:crypto only). Illustrative — swap CrossSellStore for your
// DB (see references/cross-sell.md for the Laravel migrations + Eloquent relationships
// and references/reference-implementation.md for the SQL).
//
// Encodes the behaviours that matter and are easy to get wrong:
//   admin toggle guard · 7-day cooldown · multi-tier product similarity ·
//   exclusions (purchased / completed / disliked) · signed Like/Dislike tokens ·
//   like → stop + redirect · dislike → blacklist + re-enroll · step cadence (7/10/14).

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const SEQUENCE_TYPE = Object.freeze({
  INITIAL_ABANDONMENT: 'initial_abandonment',
  CROSS_SELL: 'cross_sell',
});

export const ENROLLMENT_STATUS = Object.freeze({
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  LIKED: 'liked',
  DISLIKED: 'disliked',
  CANCELLED: 'cancelled',
});

export const FEEDBACK_ACTION = Object.freeze({ LIKE: 'like', DISLIKE: 'dislike' });

export const DEFAULT_SETTINGS = Object.freeze({
  master_enabled: false, // the base "ships paused" master switch — cross-sell never fires while off
  cross_sell_automation_enabled: true,
  cross_sell_cooldown_days: 7,
  cross_sell_reenroll_delay_hours: 24, // dislike → next product starts 24–48h later
  cross_sell_max_per_user: 5, // configurable cap on cross-sell sequences per user
  platform_product_noun_singular: 'product',
  platform_product_noun_plural: 'products',
});

// Email 1 at +0d (after the cooldown), Email 2 at +3d, Email 3 at +7d (i.e. +4 after Email 2).
export const STEP_DELAY_DAYS = Object.freeze([0, 3, 7]);

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'your', 'you', 'are', 'was', 'were',
  'has', 'have', 'had', 'from', 'into', 'our', 'its', 'they', 'them', 'then', 'than',
  'over', 'under', 'will', 'not', 'but', 'all', 'any', 'can', 'does', 'into', 'out',
]);

// ---------------------------------------------------------------------------
// Text helpers: tokenize, keyword overlap, feature extraction
// ---------------------------------------------------------------------------

export function tokenize(text) {
  if (text == null) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Jaccard similarity between two token sets — a cheap, dependency-free keyword overlap. */
export function keywordOverlap(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function concatText(product) {
  return [
    product.title,
    product.description,
    (product.features ?? []).join(' '),
    (product.bullet_points ?? []).join(' '),
    (product.specifications ?? []).join(' '),
  ].filter(Boolean).join(' ');
}

/**
 * Collapse whatever feature-like data a product carries into clean, concise bullets.
 * Prefers explicit structured fields; falls back to deriving bullets from a raw
 * description; finally synthesises bullets from the title + attributes so the email
 * never ships with an empty "here's what you get" block.
 */
export function extractFeatures(product, { max = 5 } = {}) {
  const raw = [
    ...(Array.isArray(product.features) ? product.features : []),
    ...(Array.isArray(product.bullet_points) ? product.bullet_points : []),
    ...(Array.isArray(product.specifications) ? product.specifications : []),
    ...(product.specifications && typeof product.specifications === 'object'
      ? Object.entries(product.specifications).map(([k, v]) => `${k}: ${v}`)
      : []),
  ];

  const bullets = dedupeBullets(
    raw
      .map((b) => String(b).trim())
      .filter(Boolean)
      .flatMap((b) => b.split(/\n+/))
      .map((b) => b.replace(/^[-•*·▪◦]\s*/, '').trim())
      .filter(Boolean),
  );

  if (bullets.length > 0) return bullets.slice(0, max);

  // Fallback: pull the strongest standalone sentences from the description.
  if (product.description) {
    const sentences = String(product.description)
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim().replace(/[.!?]+$/, ''))
      .filter((s) => s.length >= 12 && s.length <= 160);
    if (sentences.length > 0) return sentences.slice(0, max);
  }

  // Last resort: synthesize from the title and attributes so the block is never empty.
  const synth = [product.title ? `${product.title}` : null];
  for (const [k, v] of Object.entries(product.attributes ?? {})) {
    if (v) synth.push(`${String(k).replace(/_/g, ' ')}: ${v}`);
  }
  return dedupeBullets(synth.filter(Boolean)).slice(0, max);
}

function dedupeBullets(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Price / attribute matching (Tier 1)
// ---------------------------------------------------------------------------

/** Same price tier, or price within ±30% — never both required. */
export function priceTierMatches(a, b) {
  if (a.price_tier != null && b.price_tier != null && a.price_tier === b.price_tier) return true;
  const pa = Number(a.price);
  const pb = Number(b.price);
  if (!Number.isFinite(pa) || !Number.isFinite(pb) || pa <= 0 || pb <= 0) return false;
  const lo = Math.min(pa, pb);
  const hi = Math.max(pa, pb);
  return hi - lo <= 0.3 * lo; // within ±30% of the smaller
}

function sharedAttributeKeys(a, b) {
  const keys = new Set([...Object.keys(a.attributes ?? {}), ...Object.keys(b.attributes ?? {})]);
  let n = 0;
  for (const k of keys) {
    const av = a.attributes?.[k];
    const bv = b.attributes?.[k];
    if (av == null || bv == null) continue;
    if (String(av).toLowerCase() === String(bv).toLowerCase()) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// ProductSimilarityMatcher — multi-tier fallback
// ---------------------------------------------------------------------------

export class ProductSimilarityMatcher {
  /**
   * @param {object} opts
   * @param {Array<object>} opts.products  the active catalog
   * @param {Map<string, Map<string, number>>} [opts.coBought]  productId -> (productId -> count)
   * @param {Map<string, Map<string, number>>} [opts.coViewed]  productId -> (productId -> count)
   */
  constructor({ products = [], coBought = new Map(), coViewed = new Map() } = {}) {
    this.products = new Map(products.map((p) => [p.id, p]));
    this.coBought = coBought;
    this.coViewed = coViewed;
  }

  get(id) {
    return this.products.get(id) ?? null;
  }

  all() {
    return [...this.products.values()];
  }

  /** Weighted multi-tier score between a source product and a candidate (higher = better). */
  score(source, candidate) {
    let s = 0;

    // Tier 1 — metadata & taxonomy.
    if (source.category_id != null && candidate.category_id != null && source.category_id === candidate.category_id) {
      s += 4;
    }
    const sharedTags = (source.tags ?? []).filter((t) => (candidate.tags ?? []).includes(t));
    s += sharedTags.length * 2;
    if (priceTierMatches(source, candidate)) s += 2;
    s += sharedAttributeKeys(source, candidate) * 2;

    // Tier 2 — semantic / keyword overlap.
    s += keywordOverlap(concatText(source), concatText(candidate)) * 6;

    // Tier 3 — collaborative filtering fallback.
    s += (this.coBought.get(source.id)?.get(candidate.id) ?? 0) * 1.5;
    s += (this.coViewed.get(source.id)?.get(candidate.id) ?? 0) * 0.5;

    return s;
  }

  /** Ranked eligible candidates for `sourceProductId`, excluding the given product ids. */
  findCandidates(sourceProductId, { exclude = new Set() } = {}) {
    const source = this.products.get(sourceProductId);
    if (!source) return [];
    return [...this.products.values()]
      .filter((p) => p.id !== sourceProductId && !exclude.has(p.id))
      .map((product) => ({ product, score: this.score(source, product) }))
      .sort((a, b) => b.score - a.score || String(a.product.id).localeCompare(String(b.product.id)));
  }

  /** Next best product, or null when nothing eligible scores above zero. */
  findNextBest(sourceProductId, { exclude = new Set() } = {}) {
    const ranked = this.findCandidates(sourceProductId, { exclude });
    const best = ranked[0];
    if (!best || best.score <= 0) return null;
    return best.product;
  }

  /**
   * A short human explanation of why `candidate` was picked for `source` — used in the
   * admin/log and optionally appended to the email body.
   */
  explainMatch(source, candidate) {
    const reasons = [];
    if (source.category_id != null && source.category_id === candidate.category_id) reasons.push('same category');
    const tags = (source.tags ?? []).filter((t) => (candidate.tags ?? []).includes(t));
    if (tags.length) reasons.push(`shared interests (${tags.join(', ')})`);
    if (priceTierMatches(source, candidate)) reasons.push('similar price');
    if (sharedAttributeKeys(source, candidate) > 0) reasons.push('matching specs');
    if (keywordOverlap(concatText(source), concatText(candidate)) > 0.05) reasons.push('similar description');
    if ((this.coBought.get(source.id)?.get(candidate.id) ?? 0) > 0) reasons.push('others like you also chose it');
    return reasons.length ? reasons.join(' · ') : 'a close match';
  }
}

/** Build a co-bought matrix from a list of `{ userId, productId }` purchase rows. */
export function buildCoBuyMatrix(purchases) {
  const byUser = new Map();
  for (const { userId, productId } of purchases) {
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId).add(productId);
  }
  const co = new Map();
  const incr = (a, b) => {
    if (!co.has(a)) co.set(a, new Map());
    const row = co.get(a);
    row.set(b, (row.get(b) ?? 0) + 1);
  };
  for (const set of byUser.values()) {
    const ids = [...set];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = 0; j < ids.length; j += 1) {
        if (i !== j) incr(ids[i], ids[j]);
      }
    }
  }
  return co;
}

// ---------------------------------------------------------------------------
// Signed feedback tokens (Like / Dislike)
// ---------------------------------------------------------------------------

export const FEEDBACK_ACTIONS = Object.freeze([FEEDBACK_ACTION.LIKE, FEEDBACK_ACTION.DISLIKE]);

/**
 * Signed, single-use feedback token (HMAC-SHA256). Carries `action` ('like' | 'dislike'),
 * `enrollmentId`, `iat`, `exp` and a unique `jti`. Verify with `verifyFeedbackToken` and
 * record `jti` as used so a link cannot be replayed.
 */
export function signFeedbackToken(payload, secret, { expiresInMs = 30 * 24 * 3600 * 1000, now = Date.now() } = {}) {
  if (!secret) throw new Error('a feedback signing secret is required');
  if (!FEEDBACK_ACTIONS.includes(payload?.action)) {
    throw new RangeError(`unknown feedback action: ${String(payload?.action)}`);
  }
  if (!payload?.enrollmentId) throw new RangeError('feedback token needs enrollmentId');
  if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
    throw new RangeError('expiresInMs must be a positive number');
  }
  const body = { ...payload, iat: now, exp: now + expiresInMs, jti: randomUUID() };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyFeedbackToken(token, secret, { now = Date.now(), isUsed = null } = {}) {
  if (!secret) return null;
  const raw = String(token ?? '');
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!FEEDBACK_ACTIONS.includes(parsed.action)) return null;
  if (typeof parsed.enrollmentId !== 'string' || parsed.enrollmentId.length === 0) return null;
  if (!Number.isFinite(parsed.exp) || parsed.exp <= now) return null;
  if (!Number.isFinite(parsed.iat) || parsed.iat > now + 5 * 60 * 1000) return null;
  if (typeof parsed.jti !== 'string' || parsed.jti.length < 8) return null;
  if (typeof isUsed === 'function' && isUsed(parsed.jti)) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// In-memory store (swap for the real tables)
// ---------------------------------------------------------------------------

export class CrossSellStore {
  constructor(settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.enrollments = new Map(); // id -> enrollment
    this.rows = []; // scheduled cross-sell emails
    this.feedback = new Map(); // userId -> { liked: Set, disliked: Set }
    this.purchased = new Map(); // userId -> Set(productId)
    this.completed = new Map(); // userId -> Set(productId)
    this.promotionalOptOut = new Set(); // userId -> opted out of promotional email
    this.usedJti = new Set();
    this.users = new Map(); // userId -> { email, firstName }
  }

  setUser(userId, { email, firstName = '' }) {
    this.users.set(userId, { email, firstName });
  }
  emailOf(userId) {
    return this.users.get(userId)?.email ?? null;
  }
  firstNameOf(userId) {
    return this.users.get(userId)?.firstName ?? '';
  }

  markPurchased(userId, productId) {
    if (!this.purchased.has(userId)) this.purchased.set(userId, new Set());
    this.purchased.get(userId).add(productId);
  }
  markCompleted(userId, productId) {
    if (!this.completed.has(userId)) this.completed.set(userId, new Set());
    this.completed.get(userId).add(productId);
  }

  feedbackFor(userId) {
    if (!this.feedback.has(userId)) this.feedback.set(userId, { liked: new Set(), disliked: new Set() });
    return this.feedback.get(userId);
  }
  recordFeedback(userId, productId, action) {
    const f = this.feedbackFor(userId);
    if (action === FEEDBACK_ACTION.LIKE) f.liked.add(productId);
    else f.disliked.add(productId);
  }
  isDisliked(userId, productId) {
    return this.feedback.get(userId)?.disliked.has(productId) === true;
  }

  insertEnrollment(enrollment) {
    this.enrollments.set(enrollment.id, enrollment);
  }
  getEnrollment(id) {
    return this.enrollments.get(id) ?? null;
  }
  enrollmentsFor(userId) {
    return [...this.enrollments.values()].filter((e) => e.userId === userId);
  }
  activeCrossSellCount(userId) {
    return this.enrollmentsFor(userId).filter(
      (e) => e.sequenceType === SEQUENCE_TYPE.CROSS_SELL &&
        [ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.PAUSED].includes(e.status),
    ).length;
  }

  /** Idempotency: is this user already in an active cross-sell for this (source, recommended) pair? */
  hasActiveCrossSell(userId, recommendedProductId, sourceProductId = null) {
    return this.enrollmentsFor(userId).some(
      (e) =>
        e.sequenceType === SEQUENCE_TYPE.CROSS_SELL &&
        [ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.PAUSED].includes(e.status) &&
        e.recommendedProductId === recommendedProductId &&
        (sourceProductId == null || e.sourceProductId === sourceProductId),
    );
  }

  /** Idempotency on the *trigger*: one active cross-sell per (user, source product). */
  hasActiveCrossSellForSource(userId, sourceProductId) {
    return this.enrollmentsFor(userId).some(
      (e) =>
        e.sequenceType === SEQUENCE_TYPE.CROSS_SELL &&
        [ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.PAUSED].includes(e.status) &&
        e.sourceProductId === sourceProductId,
    );
  }

  scheduleRow(row) {
    this.rows.push({ status: 'scheduled', ...row });
  }
  cancelEnrollmentRows(enrollmentId, reason) {
    let n = 0;
    for (const r of this.rows) {
      if (r.enrollmentId === enrollmentId && r.status === 'scheduled') {
        r.status = 'cancelled';
        r.reason = reason;
        n += 1;
      }
    }
    return n;
  }
  dueRows(now) {
    return this.rows
      .filter((r) => r.status === 'scheduled' && r.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt);
  }

  markJtiUsed(jti) {
    this.usedJti.add(jti);
  }
  isJtiUsed(jti) {
    return this.usedJti.has(jti);
  }

  setPromotionalOptOut(userId, value = true) {
    if (value) this.promotionalOptOut.add(userId);
    else this.promotionalOptOut.delete(userId);
  }
  isPromotionallyOptedOut(userId) {
    return this.promotionalOptOut.has(userId);
  }

  /** Cancel every still-scheduled row for a user (admin stop-all / user stop-promotional). */
  cancelUserRows(userId, reason) {
    let n = 0;
    for (const r of this.rows) {
      if (r.userId === userId && r.status === 'scheduled') {
        r.status = 'cancelled';
        r.reason = reason;
        n += 1;
      }
    }
    return n;
  }
}

// ---------------------------------------------------------------------------
// CrossSellEngine — cooldown, enrolment, Like/Dislike, step cadence
// ---------------------------------------------------------------------------

export class CrossSellEngine {
  constructor({ store, matcher, now = () => Date.now() }) {
    this.store = store;
    this.matcher = matcher;
    this.now = now;
  }

  get settings() {
    return this.store.settings;
  }

  /** Cross-sell only runs when BOTH the base master switch and the feature toggle are on. */
  isEnabled() {
    return this.settings.master_enabled === true && this.settings.cross_sell_automation_enabled === true;
  }

  /** Why cross-sell is blocked, or null when enabled (used for `reason` in return values). */
  disabledReason() {
    if (this.settings.master_enabled !== true) return 'master-paused';
    if (this.settings.cross_sell_automation_enabled !== true) return 'disabled';
    return null;
  }

  noun(plural = false) {
    return plural ? this.settings.platform_product_noun_plural : this.settings.platform_product_noun_singular;
  }

  /** Union of everything that must never be recommended to this user again. */
  exclusionsFor(userId) {
    const exclude = new Set([
      ...(this.store.purchased.get(userId) ?? []),
      ...(this.store.completed.get(userId) ?? []),
      ...(this.store.feedback.get(userId)?.disliked ?? []),
    ]);
    for (const e of this.store.enrollmentsFor(userId)) {
      if (e.recommendedProductId) exclude.add(e.recommendedProductId);
    }
    return exclude;
  }

  /**
   * After the initial abandonment sequence completes, evaluate the next most similar
   * product and (if enabled + eligible) enrol a fresh 3-email cross-sell sequence whose
   * first email lands after `cross_sell_cooldown_days`.
   */
  maybeEnrollNext({ userId, sourceProductId, anchorAt = this.now() }) {
    // Guard: never enrol while the master switch or feature toggle is off.
    const off = this.disabledReason();
    if (off) return { enrolled: 0, reason: off };
    if (this.store.isPromotionallyOptedOut(userId)) {
      return { enrolled: 0, reason: 'opted-out' };
    }
    if (this.store.activeCrossSellCount(userId) >= this.settings.cross_sell_max_per_user) {
      return { enrolled: 0, reason: 'cap' };
    }
    // Idempotency on the trigger: a replay of "sequence completed" must not double-enrol.
    if (this.store.hasActiveCrossSellForSource(userId, sourceProductId)) {
      return { enrolled: 0, reason: 'duplicate' };
    }
    const candidate = this.matcher.findNextBest(sourceProductId, { exclude: this.exclusionsFor(userId) });
    if (!candidate) return { enrolled: 0, reason: 'no-eligible' };

    const firstSendAt = anchorAt + this.settings.cross_sell_cooldown_days * DAY_MS;
    return this._enroll({ userId, sourceProductId, recommendedProductId: candidate.id, firstSendAt });
  }

  _enroll({ userId, sourceProductId, recommendedProductId, firstSendAt }) {
    const id = `cs_${randomUUID()}`;
    const enrollment = {
      id,
      userId,
      sourceProductId,
      recommendedProductId,
      sequenceType: SEQUENCE_TYPE.CROSS_SELL,
      currentStep: 1,
      status: ENROLLMENT_STATUS.ACTIVE,
      nextSendAt: firstSendAt,
      createdAt: firstSendAt,
    };
    this.store.insertEnrollment(enrollment);

    let scheduled = 0;
    for (const [index, delayDays] of STEP_DELAY_DAYS.entries()) {
      const stepId = `${id}:step-${index + 1}`;
      this.store.scheduleRow({
        id: stepId,
        enrollmentId: id,
        userId,
        step: index + 1,
        dueAt: firstSendAt + delayDays * DAY_MS,
        productId: recommendedProductId,
      });
      scheduled += 1;
    }
    return { enrolled: 1, enrollment, scheduled };
  }

  /** Advance a cross-sell sequence to the next step after a send, or complete it after step 3. */
  advance(enrollmentId, { now = this.now() } = {}) {
    const e = this.store.getEnrollment(enrollmentId);
    if (!e || e.status !== ENROLLMENT_STATUS.ACTIVE) return { advanced: false };
    if (e.currentStep >= 3) {
      e.status = ENROLLMENT_STATUS.COMPLETED;
      this.store.markCompleted(e.userId, e.recommendedProductId);
      return { advanced: false, completed: true };
    }
    e.currentStep += 1;
    const next = this.store.rows.find((r) => r.enrollmentId === enrollmentId && r.step === e.currentStep);
    if (next) e.nextSendAt = next.dueAt;
    return { advanced: true, step: e.currentStep };
  }

  /**
   * The Like endpoint: mark `liked`, record positive intent, stop the remaining emails,
   * and hand back the redirect to the product's checkout URL (with UTM params).
   */
  like(enrollmentId, { now = this.now(), utm = {} } = {}) {
    const e = this.store.getEnrollment(enrollmentId);
    if (!e) return { ok: false, reason: 'not-found' };
    e.status = ENROLLMENT_STATUS.LIKED;
    e.likedAt = now;
    this.store.recordFeedback(e.userId, e.recommendedProductId, FEEDBACK_ACTION.LIKE);
    const cancelled = this.store.cancelEnrollmentRows(enrollmentId, 'liked');
    const product = this.matcher.get(e.recommendedProductId);
    return {
      ok: true,
      status: ENROLLMENT_STATUS.LIKED,
      cancelled,
      redirect: buildCheckoutUrl(product, utm),
    };
  }

  /**
   * The Dislike endpoint: blacklist the recommended product for this user, halt the
   * current sequence, then find the *next* eligible similar product and schedule a new
   * 3-email sequence after `cross_sell_reenroll_delay_hours` (24–48h) so they aren't
   * spammed in the same second.
   */
  dislike(enrollmentId, { now = this.now(), utm = {} } = {}) {
    const e = this.store.getEnrollment(enrollmentId);
    if (!e) return { ok: false, reason: 'not-found' };
    e.status = ENROLLMENT_STATUS.DISLIKED;
    e.dislikedAt = now;
    this.store.recordFeedback(e.userId, e.recommendedProductId, FEEDBACK_ACTION.DISLIKE);
    const cancelled = this.store.cancelEnrollmentRows(enrollmentId, 'disliked');

    const product = this.matcher.get(e.recommendedProductId);
    let next = null;
    if (this.isEnabled() && !this.store.isPromotionallyOptedOut(e.userId)) {
      const candidate = this.matcher.findNextBest(e.sourceProductId, { exclude: this.exclusionsFor(e.userId) });
      if (candidate && this.store.activeCrossSellCount(e.userId) < this.settings.cross_sell_max_per_user) {
        const firstSendAt = now + this.settings.cross_sell_reenroll_delay_hours * HOUR_MS;
        next = this._enroll({
          userId: e.userId,
          sourceProductId: e.sourceProductId,
          recommendedProductId: candidate.id,
          firstSendAt,
        });
      }
    }

    return {
      ok: true,
      status: ENROLLMENT_STATUS.DISLIKED,
      cancelled,
      productName: product?.title ?? null,
      reEnrolled: next ? next.enrolled : 0,
      nextEnrollment: next?.enrollment ?? null,
    };
  }

  /** The worker entrypoint: send every due cross-sell email and advance the sequence. */
  async processDue({ send = async () => {}, now = this.now() } = {}) {
    // Guard: never dispatch a cross-sell email while the master switch or toggle is off.
    const off = this.disabledReason();
    if (off) return { sent: 0, reason: off };
    let sent = 0;
    for (const row of this.store.dueRows(now)) {
      const e = this.store.getEnrollment(row.enrollmentId);
      if (!e || e.status !== ENROLLMENT_STATUS.ACTIVE) {
        row.status = 'cancelled';
        row.reason = 'not-active';
        continue;
      }
      // Guard: a user who opted out of promotional email gets nothing more.
      if (this.store.isPromotionallyOptedOut(row.userId)) {
        row.status = 'cancelled';
        row.reason = 'promotional-optout';
        continue;
      }
      row.status = 'sent';
      row.sentAt = now;
      await send({ userId: row.userId, enrollment: e, step: row.step, productId: row.productId });
      this.advance(row.enrollmentId, { now });
      sent += 1;
    }
    return { sent };
  }

  // -------------------------------------------------------------------------
  // User-profile surface: list / stop one / stop all / add / self-service opt-out
  // -------------------------------------------------------------------------

  /** Find products by exact id, else by case-insensitive title substring. */
  searchProduct(query) {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const byId = this.matcher.get(q);
    if (byId) return [byId];
    const lower = q.toLowerCase();
    return this.matcher.all().filter((p) => (p.title ?? '').toLowerCase().includes(lower));
  }

  /** A product title (or id when the product is unknown/deleted). */
  productTitle(productId) {
    return this.matcher.get(productId)?.title ?? productId;
  }

  /**
   * Group a user's sequences for the admin profile view.
   *  - active   → enrollments currently in flight (status active / paused)
   *  - previous → enrollments with a terminal status (completed / liked / disliked / cancelled)
   *  - pending  → still-scheduled future emails (what's queued next), per product
   */
  listSequences(userId) {
    const enrollments = this.store.enrollmentsFor(userId);
    const active = [];
    const previous = [];
    for (const e of enrollments) {
      const view = {
        enrollmentId: e.id,
        sequenceType: e.sequenceType,
        productId: e.recommendedProductId ?? e.sourceProductId,
        productTitle: this.productTitle(e.recommendedProductId ?? e.sourceProductId),
        status: e.status,
        currentStep: e.currentStep,
        nextSendAt: e.nextSendAt ?? null,
        reason: e.cancelReason ?? null,
      };
      if ([ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.PAUSED].includes(e.status)) {
        active.push(view);
      } else {
        previous.push(view);
      }
    }
    const pending = this.store.rows
      .filter((r) => r.userId === userId && r.status === 'scheduled')
      .map((r) => ({
        enrollmentId: r.enrollmentId,
        productId: r.productId,
        productTitle: this.productTitle(r.productId),
        step: r.step,
        dueAt: r.dueAt,
      }))
      .sort((a, b) => a.dueAt - b.dueAt);
    return { active, previous, pending };
  }

  /** Admin: stop a single sequence (cancels its remaining scheduled emails). */
  stopSequence(enrollmentId, { actor = 'admin', now = this.now() } = {}) {
    const e = this.store.getEnrollment(enrollmentId);
    if (!e) return { ok: false, reason: 'not-found' };
    if (![ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.PAUSED].includes(e.status)) {
      return { ok: false, reason: 'not-active', status: e.status };
    }
    e.status = ENROLLMENT_STATUS.CANCELLED;
    e.cancelReason = actor;
    e.cancelledAt = now;
    const cancelled = this.store.cancelEnrollmentRows(enrollmentId, `stopped:${actor}`);
    return { ok: true, stopped: 1, cancelled };
  }

  /**
   * Stop every active/paused sequence for a user.
   *  - actor 'user'  → the profile "Stop promotional emails" button (flips opt-out, so no
   *    future sequence re-enrols).
   *  - actor 'admin' → an admin force-stops all sequences without flipping consent.
   */
  stopAllSequences(userId, { actor = 'admin', now = this.now() } = {}) {
    let stopped = 0;
    for (const e of this.store.enrollmentsFor(userId)) {
      if ([ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.PAUSED].includes(e.status)) {
        e.status = ENROLLMENT_STATUS.CANCELLED;
        e.cancelReason = actor;
        e.cancelledAt = now;
        stopped += 1;
      }
    }
    const cancelled = this.store.cancelUserRows(userId, `stopped:${actor}`);
    return { ok: true, stopped, cancelled };
  }

  /** User self-service: stop receiving promotional emails — stops all sequences. */
  stopPromotionalEmail(userId, { now = this.now() } = {}) {
    this.store.setPromotionalOptOut(userId, true);
    const res = this.stopAllSequences(userId, { actor: 'user', now });
    return { ok: true, promotionalOptOut: true, ...res };
  }

  /**
   * Admin: add a user to a cross-sell sequence for a specific product (selected by id or
   * title search), bypassing similarity. Respects the toggle, the user's promotional
   * opt-out, the per-user cap, and the dislike/purchase blacklist.
   */
  enrollForProduct({ userId, productId, sourceProductId = null, anchorAt = this.now() }) {
    const off = this.disabledReason();
    if (off) return { enrolled: 0, reason: off };
    if (this.store.isPromotionallyOptedOut(userId)) return { enrolled: 0, reason: 'opted-out' };
    if (this.store.activeCrossSellCount(userId) >= this.settings.cross_sell_max_per_user) {
      return { enrolled: 0, reason: 'cap' };
    }
    const product = this.matcher.get(productId);
    if (!product) return { enrolled: 0, reason: 'not-found' };
    if (this.store.purchased.get(userId)?.has(productId)) return { enrolled: 0, reason: 'purchased' };
    if (this.store.isDisliked(userId, productId)) return { enrolled: 0, reason: 'disliked' };
    // Idempotency: adding the same product twice is a no-op.
    if (this.store.hasActiveCrossSell(userId, productId, sourceProductId)) {
      return { enrolled: 0, reason: 'duplicate' };
    }

    const firstSendAt = anchorAt; // admin-initiated: start immediately (worker applies the send window)
    return this._enroll({ userId, sourceProductId, recommendedProductId: productId, firstSendAt });
  }
}

/** Build a checkout/purchase URL with UTM params so the Like click is attributable. */
export function buildCheckoutUrl(product, utm = {}) {
  const base = product?.checkout_url ?? product?.url ?? `https://example.com/checkout/${product?.id ?? ''}`;
  const params = new URLSearchParams({
    utm_source: 'email',
    utm_medium: 'cross-sell',
    utm_campaign: 'cross-sell-like',
    ...utm,
  });
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${params.toString()}`;
}
