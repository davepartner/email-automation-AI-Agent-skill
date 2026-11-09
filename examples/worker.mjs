import { createHmac, timingSafeEqual } from 'node:crypto';
import { nextOccurrence } from './schedule.mjs';

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
      group: 'treatment',
      channel: 'email',
      productId: null,
      ...row,
    });
  }
  dueScheduled(now, limit) {
    return [...this.rows.values()]
      .filter((r) => r.status === 'scheduled' && r.dueAt <= now)
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
    }

    let scheduled = 0;
    for (const step of stepDefs) {
      const dueAt = step.schedule
        ? step.schedule.type === 'calendar'
          ? nextOccurrence(at, step.schedule.day, { hour: step.schedule.hour ?? 9 })
          : at + (step.schedule.minutes ?? 0) * 60 * 1000
        : at + (step.delayMinutes ?? 0) * 60 * 1000;

      this.store.insertScheduled({
        id: nextId(),
        enrollmentId,
        sequenceKey,
        stepId: step.id,
        userId,
        dueAt,
        stopCondition: step.stopCondition ?? 'purchased',
        kind: meta.kind,
        priority: meta.priority,
        group,
        channel: step.channel ?? 'email',
        productId,
      });
      scheduled += 1;
    }
    return scheduled;
  }

  localHour(nowMs, offsetMinutes) {
    const utcHour = Math.floor(nowMs / 3_600_000) % 24;
    const shifted = utcHour + Math.floor(offsetMinutes / 60);
    return ((shifted % 24) + 24) % 24;
  }

  async processDue(limit = 100) {
    const report = { sent: 0, cancelled: 0, deferred: 0, failed: 0 };
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
    if ((row.deferrals ?? 0) >= this.maxDeferrals) {
      this.store.markCancelled(row.id, `max-deferrals:${reason}`);
      report.cancelled += 1;
    } else {
      this.store.reschedule(row.id, now + 60 * 60 * 1000, { countDeferral: true });
      report.deferred += 1;
    }
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

/** Signed, unguessable unsubscribe token (HMAC-SHA256). */
export function signUnsubscribeToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload ?? {})).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify an unsubscribe token; returns the payload or null. */
export function verifyUnsubscribeToken(token, secret) {
  const raw = String(token ?? '');
  const idx = raw.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
