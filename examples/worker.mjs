import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { nextOccurrence, validateAnchor } from './schedule.mjs';
import { LEAD, moveToPaid } from './leads.mjs';

// Reference scheduler/worker core. Zero runtime deps (node:crypto only).
// Illustrative — swap MemoryStore for your DB (see references/reference-implementation.md
// for the SQL: SELECT ... FOR UPDATE SKIP LOCKED, reaper, batching).
//
// Encodes the behaviours that actually matter and are easy to get wrong:
//   idempotency · stop conditions · consent · holdout · precedence · exclusions ·
//   timezone-aware send window · frequency cap · retry cap · max deferral ·
//   transactional vs marketing · signed unsubscribe · erasure.

let idSeq = 0;
const nextId = () => `sched_${++idSeq}_${Math.random().toString(36).slice(2, 8)}`;

export const KIND = { MARKETING: 'marketing', TRANSACTIONAL: 'transactional', NURTURE: 'nurture' };

// Lower number = higher priority (purchase wins over win-back).
export const PRIORITY = {
  purchase: 1,
  cart: 2,
  browse: 3,
  welcome: 4,
  no_login: 5,
  payday: 6,
  inactive: 7,
  win_back: 8,
};

export class MemoryStore {
  constructor() {
    this.rows = new Map();
    this.sent = [];
    this.suppressions = new Map(); // email -> reason
    this.consent = new Map(); // userId -> boolean
    this.timezones = new Map(); // userId -> UTC offset in minutes
    this.users = new Map(); // userId -> { email }
    this.exclusions = new Set(); // `${userId}:${stepId}`
    this.sequences = new Map(); // key -> { kind, priority }
    this.channelConsent = new Map(); // `${userId}:${channel}` -> boolean
    this.channelSuppressed = new Map(); // `${userId}:${channel}` -> reason
    this.optOuts = new Map(); // `${userId}:${sequenceKey}:${productId|*}` -> reason
    this.leads = new Map(); // `${userId}:${productId}` -> { stage, status, purchasedAtMs }
    this.enrollmentSteps = new Set(); // `${enrollmentId}:${stepId}` -> idempotency
  }

  setUser(userId, { email, timezoneOffsetMinutes = 0, consentMarketing = true }) {
    this.users.set(userId, { email });
    this.timezones.set(userId, timezoneOffsetMinutes);
    this.consent.set(userId, consentMarketing);
  }
  emailOf(userId) {
    return this.users.get(userId)?.email ?? null;
  }
  offsetOf(userId) {
    return this.timezones.get(userId) ?? 0;
  }
  setConsent(userId, value) {
    this.consent.set(userId, value);
  }
  hasConsent(userId) {
    return this.consent.get(userId) === true;
  }
  setChannelConsent(userId, channel, value) {
    this.channelConsent.set(`${userId}:${channel}`, value);
  }
  hasChannelConsent(userId, channel) {
    if (channel === 'email') return this.hasConsent(userId);
    return this.channelConsent.get(`${userId}:${channel}`) === true;
  }
  suppressChannel(userId, channel, reason) {
    this.channelSuppressed.set(`${userId}:${channel}`, reason);
  }
  isChannelSuppressed(userId, channel) {
    return this.channelSuppressed.has(`${userId}:${channel}`);
  }
  /** Scoped opt-out: one sequence for one product (productId null = all products of that sequence). */
  optOut(userId, sequenceKey, productId, reason = 'unsubscribed') {
    this.optOuts.set(`${userId}:${sequenceKey}:${productId ?? '*'}`, reason);
  }
  isOptedOut(userId, sequenceKey, productId) {
    return (
      this.optOuts.has(`${userId}:${sequenceKey}:${productId ?? '*'}`) ||
      this.optOuts.has(`${userId}:${sequenceKey}:*`)
    );
  }
  getLead(userId, productId) {
    return this.leads.get(`${userId}:${productId}`) ?? null;
  }
  setLead(userId, productId, lead) {
    this.leads.set(`${userId}:${productId}`, lead);
  }
  /** Cancel every still-scheduled row for one product (purchase or opt-out). */
  cancelProductRows(userId, productId, reason, { excludeSequenceKeys = [] } = {}) {
    const skip = new Set(excludeSequenceKeys);
    let n = 0;
    for (const r of this.rows.values()) {
      if (
        r.userId === userId &&
        r.productId === productId &&
        r.status === 'scheduled' &&
        !skip.has(r.sequenceKey)
      ) {
        r.status = 'cancelled';
        r.reason = reason;
        n += 1;
      }
    }
    return n;
  }
  /** Cancel every still-scheduled row for one sequence (scoped unsubscribe). */
  cancelSequenceRows(userId, sequenceKey, reason) {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.userId === userId && r.sequenceKey === sequenceKey && r.status === 'scheduled') {
        r.status = 'cancelled';
        r.reason = reason;
        n += 1;
      }
    }
    return n;
  }
  /** Cancel every still-scheduled row for a user (global unsubscribe / admin exclude). */
  cancelAllScheduled(userId, reason) {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.userId === userId && r.status === 'scheduled') {
        r.status = 'cancelled';
        r.reason = reason;
        n += 1;
      }
    }
    return n;
  }
  hasEnrollmentStep(enrollmentId, stepId) {
    return this.enrollmentSteps.has(`${enrollmentId}:${stepId}`);
  }
  markEnrollmentStep(enrollmentId, stepId) {
    this.enrollmentSteps.add(`${enrollmentId}:${stepId}`);
  }
  suppress(email, reason) {
    if (email) this.suppressions.set(email, reason);
  }
  isSuppressed(email) {
    return this.suppressions.has(email);
  }
  suppressionReason(email) {
    return this.suppressions.get(email) ?? null;
  }
  excludeStep(userId, stepId) {
    this.exclusions.add(`${userId}:${stepId}`);
  }
  isExcluded(userId, stepId) {
    return this.exclusions.has(`${userId}:${stepId}`);
  }
  registerSequence(key, meta) {
    this.sequences.set(key, meta);
  }
  sequenceMeta(key) {
    return this.sequences.get(key) ?? { kind: KIND.MARKETING, priority: 5 };
  }

  insertScheduled(row) {
    this.rows.set(row.id, {
      attempts: 0,
      deferrals: 0,
      status: 'scheduled',
      lockedAt: null,
      kind: KIND.MARKETING,
      priority: 5,
      group: 'treatment',
      channel: 'email',
      productId: null,
      scheduleType: null,
      ...row,
    });
  }
  dueScheduled(now, limit) {
    return [...this.rows.values()]
      .filter((r) => r.status === 'scheduled' && r.dueAt <= now)
      // Highest priority first (lower number), then oldest due, so the
      // frequency cap defers the least important email, not an arbitrary one.
      .sort((a, b) => a.priority - b.priority || a.dueAt - b.dueAt || (a.id < b.id ? -1 : 1))
      .slice(0, limit);
  }
  claim(id, now) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'scheduled') return false;
    row.status = 'sending';
    row.lockedAt = now;
    return true;
  }
  markSent(id, now) {
    const row = this.rows.get(id);
    if (!row) return;
    row.status = 'sent';
    row.sentAt = now;
    this.sent.push({
      id,
      userId: row.userId,
      stepId: row.stepId,
      sequenceKey: row.sequenceKey,
      kind: row.kind,
      channel: row.channel,
      productId: row.productId ?? null,
      sentAt: now,
    });
  }
  markCancelled(id, reason) {
    const row = this.rows.get(id);
    if (row) {
      row.status = 'cancelled';
      row.reason = reason;
    }
  }
  markFailed(id, error) {
    const row = this.rows.get(id);
    if (row) {
      row.status = 'failed';
      row.error = String(error);
    }
  }
  /**
   * A date-anchored email that could not go out on its intended local date.
   * Distinct from `cancelled` so the admin can see a missed reminder and act.
   */
  markMissed(id, reason) {
    const row = this.rows.get(id);
    if (row) {
      row.status = 'missed';
      row.reason = reason;
    }
  }
  reschedule(id, dueAt, { countDeferral = false } = {}) {
    const row = this.rows.get(id);
    if (row && row.status === 'sending') {
      row.status = 'scheduled';
      row.lockedAt = null;
      row.dueAt = dueAt;
      if (countDeferral) row.deferrals += 1;
    }
  }
  stuck(now, timeoutMs) {
    return [...this.rows.values()].filter(
      (r) => r.status === 'sending' && r.lockedAt != null && now - r.lockedAt > timeoutMs,
    );
  }
  sentSince(userId, since, kinds = null) {
    return this.sent.filter(
      (s) =>
        s.userId === userId &&
        s.sentAt >= since &&
        (!kinds || kinds.includes(s.kind)),
    ).length;
  }
  activeMarketingPriority(userId) {
    let min = null;
    for (const r of this.rows.values()) {
      if (r.userId === userId && r.kind === KIND.MARKETING && r.status === 'scheduled') {
        if (min === null || r.priority < min) min = r.priority;
      }
    }
    return min;
  }
  cancelLowerPriorityMarketing(userId, priority) {
    let n = 0;
    for (const r of this.rows.values()) {
      if (
        r.userId === userId &&
        r.status === 'scheduled' &&
        r.kind === KIND.MARKETING &&
        r.priority > priority
      ) {
        r.status = 'cancelled';
        r.reason = 'precedence';
        n += 1;
      }
    }
    return n;
  }
  reaper(id) {
    const row = this.rows.get(id);
    if (row) {
      row.status = 'scheduled';
      row.lockedAt = null;
      row.attempts = (row.attempts ?? 0) + 1;
    }
  }
  eraseUser(userId) {
    for (const [id, r] of [...this.rows]) if (r.userId === userId) this.rows.delete(id);
    this.sent = this.sent.filter((s) => s.userId !== userId);
    for (const key of [...this.optOuts.keys()]) if (key.startsWith(`${userId}:`)) this.optOuts.delete(key);
    for (const key of [...this.leads.keys()]) if (key.startsWith(`${userId}:`)) this.leads.delete(key);
    this.users.delete(userId);
    this.consent.delete(userId);
    this.timezones.delete(userId);
  }
}

export class EmailWorker {
  constructor({
    store,
    sendEmail,
    isEligible = () => true,
    now = () => Date.now(),
    maxPerDay = 1,
    dayMs = 24 * 3600 * 1000,
    sendWindow = { start: 8, end: 21 },
    maxAttempts = 3,
    maxDeferrals = 3,
  }) {
    Object.assign(this, {
      store,
      sendEmail,
      isEligible,
      now,
      maxPerDay,
      dayMs,
      sendWindow,
      maxAttempts,
      maxDeferrals,
    });
  }

  /**
   * Materialise a sequence's steps. Enforces holdout + precedence:
   * only the highest-priority marketing sequence may be active per user.
   *
   * Calendar steps are anchored SEQUENTIALLY: each one resolves after the previous
   * step's due time, in the user's local time. Anchoring all three to `at` (the old
   * behaviour) could schedule the "2nd" email before the "27th" one.
   * Enrolment is idempotent on (enrollmentId, stepId), so replaying an event or a
   * purchase webhook never double-schedules.
   */
  enroll({ userId, enrollmentId, sequenceKey, stepDefs, at = this.now(), group = 'treatment', productId = null }) {
    const meta = this.store.sequenceMeta(sequenceKey);

    // Precedence applies to PROMOTIONAL (marketing) sequences only. Nurture sequences
    // (per-product payday reminders) and transactional ones are not cancelled here;
    // same-day clashes are prevented by the cross-sequence frequency cap.
    if (meta.kind === KIND.MARKETING) {
      if (group === 'holdout') return 0; // holdout users get no marketing email
      const active = this.store.activeMarketingPriority(userId);
      if (active !== null && active < meta.priority) return 0; // a higher-priority sequence wins
      this.store.cancelLowerPriorityMarketing(userId, meta.priority);
    } else if (meta.kind !== KIND.TRANSACTIONAL && group === 'holdout') {
      // Holdout applies to nurture too; only transactional messages bypass it.
      return 0;
    }

    const offset = this.store.offsetOf(userId); // minutes east of UTC
    let cursor = at; // calendar steps chain from the previous due time
    let scheduled = 0;

    for (const [index, step] of stepDefs.entries()) {
      const stepId = step.id ?? `step-${step.position ?? index + 1}`;
      if (this.store.hasEnrollmentStep(enrollmentId, stepId)) continue; // idempotent replay

      let dueAt;
      let scheduleType = null;
      if (step.schedule?.type === 'calendar') {
        validateAnchor(step.schedule.day);
        dueAt = nextOccurrence(cursor, step.schedule.day, {
          hour: step.schedule.hour ?? 9,
          utcOffsetMinutes: offset,
        });
        if (dueAt == null) throw new Error(`could not resolve calendar step ${stepId}`);
        cursor = dueAt;
        scheduleType = 'calendar';
      } else if (step.schedule) {
        dueAt = at + (step.schedule.minutes ?? 0) * 60 * 1000;
      } else {
        dueAt = at + (step.delayMinutes ?? 0) * 60 * 1000;
      }
      if (!Number.isFinite(dueAt)) throw new TypeError(`step ${stepId} has no valid due time`);

      this.store.insertScheduled({
        id: nextId(),
        enrollmentId,
        sequenceKey,
        stepId,
        userId,
        dueAt,
        stopCondition: step.stopCondition ?? 'purchased',
        kind: meta.kind,
        priority: meta.priority,
        group,
        channel: step.channel ?? 'email',
        productId,
        scheduleType,
      });
      this.store.markEnrollmentStep(enrollmentId, stepId);
      scheduled += 1;
    }
    return scheduled;
  }

  /**
   * Purchase → leave the lead sequence, enter the paid one. Safe to replay:
   * cancelling and enrolling are both idempotent.
   */
  handlePurchase({ userId, productId, purchasedAt = this.now(), paidSequences = [] }) {
    const lead = this.store.getLead(userId, productId);
    const wasPaid = lead?.stage === LEAD.PAID;

    // Always cancel pending reminders first, so a paid user can never receive
    // a "you left something behind" email from the previous enrolment. The paid
    // sequences are excluded so replaying the purchase never cancels them.
    const cancelled = this.store.cancelProductRows(userId, productId, 'purchased', {
      excludeSequenceKeys: paidSequences.map((s) => s.sequenceKey),
    });

    if (!wasPaid) {
      const base = lead ?? { userId, productId, stage: LEAD.LEAD, status: 'active' };
      this.store.setLead(userId, productId, moveToPaid(base, { purchasedAtMs: purchasedAt }));
    }

    let enrolled = 0;
    for (const seq of paidSequences) {
      enrolled += this.enroll({
        userId,
        enrollmentId: seq.enrollmentId ?? `purchase:${userId}:${productId}:${seq.sequenceKey}`,
        sequenceKey: seq.sequenceKey,
        stepDefs: seq.stepDefs,
        at: purchasedAt,
        productId, // paid sequences are scoped to the product they bought
      });
    }

    return { moved: !wasPaid, cancelled, enrolled };
  }

  localHour(nowMs, offsetMinutes = 0) {
    // Shifting the instant and reading UTC hours also handles half-hour offsets (+05:30).
    return new Date(nowMs + offsetMinutes * 60_000).getUTCHours();
  }

  /** Start of the local day containing `ms`, as a UTC timestamp. */
  localDayStart(ms, offsetMinutes = 0) {
    const dayMs = 24 * 3_600_000;
    const offset = offsetMinutes * 60_000;
    return Math.floor((ms + offset) / dayMs) * dayMs - offset;
  }

  async processDue(limit = 100) {
    const report = { sent: 0, cancelled: 0, deferred: 0, missed: 0, failed: 0 };
    const now = this.now();

    for (const row of this.store.dueScheduled(now, limit)) {
      if (!this.store.claim(row.id, now)) continue;
      const email = this.store.emailOf(row.userId);
      const channel = row.channel ?? 'email';

      // Non-email channels require explicit per-channel opt-in + are per-channel suppressed.
      if (channel !== 'email') {
        if (!this.store.hasChannelConsent(row.userId, channel)) {
          this.store.markCancelled(row.id, 'no-channel-consent');
          report.cancelled += 1;
          continue;
        }
        if (this.store.isChannelSuppressed(row.userId, channel)) {
          this.store.markCancelled(row.id, 'channel-suppressed');
          report.cancelled += 1;
          continue;
        }
      }

      // A date-anchored email whose local date has passed must never go out late
      // (e.g. the worker was down over the 27th and wakes on the 28th).
      if (row.scheduleType === 'calendar') {
        const offset = this.store.offsetOf(row.userId);
        if (this.localDayStart(row.dueAt, offset) !== this.localDayStart(now, offset)) {
          this.store.markMissed(row.id, 'missed:stale-date');
          report.missed += 1;
          continue;
        }
      }

      // Scoped opt-out: the user unsubscribed from this sequence for this product.
      if (this.store.isOptedOut(row.userId, row.sequenceKey, row.productId)) {
        this.store.markCancelled(row.id, 'sequence-optout');
        report.cancelled += 1;
        continue;
      }

      if (row.kind !== KIND.TRANSACTIONAL) {
        if (this.store.isSuppressed(email)) {
          this.store.markCancelled(row.id, 'suppressed');
          report.cancelled += 1;
          continue;
        }
        if (!this.store.hasConsent(row.userId)) {
          this.store.markCancelled(row.id, 'no-consent');
          report.cancelled += 1;
          continue;
        }
        if (row.group === 'holdout') {
          this.store.markCancelled(row.id, 'holdout');
          report.cancelled += 1;
          continue;
        }
      } else {
        // Transactional bypasses marketing consent/suppression, but not undeliverable addresses.
        const reason = this.store.suppressionReason(email);
        if (reason === 'hard_bounce' || reason === 'complaint') {
          this.store.markCancelled(row.id, 'undeliverable');
          report.cancelled += 1;
          continue;
        }
      }

      // Admin excluded this user from this specific email.
      if (this.store.isExcluded(row.userId, row.stepId)) {
        this.store.markCancelled(row.id, 'admin-excluded');
        report.cancelled += 1;
        continue;
      }

      // Stop condition: never email a user who already converted.
      if (!this.isEligible({ userId: row.userId, stopCondition: row.stopCondition })) {
        this.store.markCancelled(row.id, `stop:${row.stopCondition}`);
        report.cancelled += 1;
        continue;
      }

      // Frequency cap (marketing only).
      if (
        row.kind !== KIND.TRANSACTIONAL &&
        this.store.sentSince(row.userId, now - this.dayMs, [KIND.MARKETING, KIND.NURTURE]) >= this.maxPerDay
      ) {
        this.deferOrCancel(row, now, 'frequency-cap', report);
        continue;
      }

      // Quiet hours in the USER's timezone.
      const localHour = this.localHour(now, this.store.offsetOf(row.userId));
      if (!isWithinAllowedSendWindow(localHour, this.sendWindow.start, this.sendWindow.end)) {
        this.deferOrCancel(row, now, 'quiet-hours', report);
        continue;
      }

      try {
        await this.sendEmail({ userId: row.userId, stepId: row.stepId, kind: row.kind, channel, rowId: row.id });
        this.store.markSent(row.id, now);
        report.sent += 1;
      } catch (err) {
        this.store.markFailed(row.id, err);
        report.failed += 1;
      }
    }
    return report;
  }

  deferOrCancel(row, now, reason, report) {
    if (row.scheduleType === 'calendar') {
      this.deferOrMissCalendar(row, now, reason, report);
      return;
    }
    if ((row.deferrals ?? 0) >= this.maxDeferrals) {
      this.store.markCancelled(row.id, `max-deferrals:${reason}`);
      report.cancelled += 1;
    } else {
      this.store.reschedule(row.id, now + 60 * 60 * 1000, { countDeferral: true });
      report.deferred += 1;
    }
  }

  /**
   * Calendar emails are date-anchored, so they get a different rule:
   *  - before the send window on the same local date → move to the window start;
   *  - blocked by the daily cap, or already past the window → `missed` (visible
   *    to the admin), never silently cancelled and never sent a day late.
   */
  deferOrMissCalendar(row, now, reason, report) {
    const hourMs = 3_600_000;
    const offsetMinutes = this.store.offsetOf(row.userId);
    const localMidnight = this.localDayStart(now, offsetMinutes);

    // The intended date has passed (worker down, long deferral): record it as missed.
    if (this.localDayStart(row.dueAt, offsetMinutes) !== localMidnight) {
      this.store.markMissed(row.id, 'missed:stale-date');
      report.missed += 1;
      return;
    }

    const windowStart = localMidnight + this.sendWindow.start * hourMs;

    if (reason === 'frequency-cap' || (row.deferrals ?? 0) >= this.maxDeferrals) {
      this.store.markMissed(row.id, `missed:${reason}`);
      report.missed += 1;
      return;
    }
    if (now < windowStart) {
      this.store.reschedule(row.id, windowStart, { countDeferral: true });
      report.deferred += 1;
      return;
    }
    this.store.markMissed(row.id, `missed:${reason}`);
    report.missed += 1;
  }

  /** Recover rows a crashed worker left in 'sending'; cap retries. */
  reapStuck(timeoutMs = 5 * 60 * 1000) {
    const result = { reaped: 0, failed: 0 };
    for (const row of this.store.stuck(this.now(), timeoutMs)) {
      if ((row.attempts ?? 0) >= this.maxAttempts) {
        this.store.markFailed(row.id, 'max-attempts');
        result.failed += 1;
      } else {
        this.store.reaper(row.id);
        result.reaped += 1;
      }
    }
    return result;
  }
}

/** Allowed send window (e.g. 08:00–21:00). Supports wrap-around (start > end). */
export function isWithinAllowedSendWindow(hour, start = 8, end = 21) {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/** Allowed unsubscribe scopes. A token without one is rejected (never assumed global). */
export const UNSUBSCRIBE_SCOPES = Object.freeze(['all', 'sequence', 'product']);

/**
 * Signed, unguessable unsubscribe token (HMAC-SHA256).
 *
 * Every token carries `scope`, `iat`, `exp` and a unique `jti`:
 *   scope: 'all'      → global marketing unsubscribe
 *   scope: 'sequence' → this sequence (all products)  (needs sequenceKey)
 *   scope: 'product'  → this sequence for one product  (needs sequenceKey + productId)
 *
 * Verify with `verifyUnsubscribeToken` and record `jti` as used so a link cannot
 * be replayed. Rotation: verify with the current secret, fall back to the previous
 * one during a key rollover — never accept an unsigned token.
 */
export function signUnsubscribeToken(payload, secret, { expiresInMs = 30 * 24 * 3600 * 1000, now = Date.now() } = {}) {
  if (!secret) throw new Error('an unsubscribe signing secret is required');
  const scope = payload?.scope ?? 'all';
  if (!UNSUBSCRIBE_SCOPES.includes(scope)) throw new RangeError(`unknown unsubscribe scope: ${String(scope)}`);
  if (scope !== 'all' && !payload?.sequenceKey) {
    throw new RangeError(`scope "${scope}" needs sequenceKey`);
  }
  if (scope === 'product' && !payload?.productId) {
    throw new RangeError('scope "product" needs productId');
  }
  if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
    throw new RangeError('expiresInMs must be a positive number');
  }

  const body = { ...payload, scope, iat: now, exp: now + expiresInMs, jti: randomUUID() };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * Verify an unsubscribe token; returns the payload or null.
 * Rejects: bad signature, malformed payload, missing/unknown scope, expired token,
 * a token issued in the future, missing jti, and (when `isUsed` is supplied) a
 * token whose jti was already consumed.
 */
export function verifyUnsubscribeToken(token, secret, { now = Date.now(), isUsed = null } = {}) {
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
  if (!UNSUBSCRIBE_SCOPES.includes(parsed.scope)) return null; // legacy {userId,email} tokens are refused
  if (!Number.isFinite(parsed.exp) || parsed.exp <= now) return null;
  if (!Number.isFinite(parsed.iat) || parsed.iat > now + 5 * 60 * 1000) return null;
  if (typeof parsed.jti !== 'string' || parsed.jti.length < 8) return null;
  if (parsed.scope !== 'all' && !parsed.sequenceKey) return null;
  if (parsed.scope === 'product' && !parsed.productId) return null;
  if (typeof isUsed === 'function' && isUsed(parsed.jti)) return null;

  return parsed;
}

/**
 * Apply a verified unsubscribe payload to the store, honouring its scope.
 * Returns the scope and how many scheduled rows were cancelled.
 */
export function applyUnsubscribe(store, payload, { email = null } = {}) {
  if (!payload || !UNSUBSCRIBE_SCOPES.includes(payload.scope)) {
    throw new TypeError('applyUnsubscribe needs a verified payload with a known scope');
  }
  if (payload.scope === 'product') {
    store.optOut(payload.userId, payload.sequenceKey, payload.productId, 'unsubscribed');
    return {
      scope: 'product',
      cancelled: store.cancelProductRows(payload.userId, payload.productId, 'sequence-optout'),
    };
  }
  if (payload.scope === 'sequence') {
    store.optOut(payload.userId, payload.sequenceKey, null, 'unsubscribed');
    return {
      scope: 'sequence',
      cancelled: store.cancelSequenceRows(payload.userId, payload.sequenceKey, 'sequence-optout'),
    };
  }
  const address = email ?? payload.email ?? store.emailOf?.(payload.userId) ?? null;
  if (!address) throw new Error('a global unsubscribe needs an email address');
  store.suppress(address, 'unsubscribed');
  return { scope: 'all', cancelled: store.cancelAllScheduled(payload.userId, 'unsubscribed') };
}
