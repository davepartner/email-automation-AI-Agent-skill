// Calendar-anchored scheduling for payday-cycle sequences (27th, last day, 2nd).
// `hour` and `utcOffsetMinutes` describe the USER's local time: a step at 09:00 with
// offset +60 fires at 08:00 UTC. Offsets (not IANA zones) keep this dependency-free;
// pass the offset the app knows for that user/date.

export function lastDayOfMonth(year, month /* 1-12 */) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Throw on a bad anchor instead of silently scheduling "immediately". */
export function validateAnchor(anchor) {
  if (anchor === 'last') return anchor;
  const n = Number(anchor);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new RangeError(`invalid calendar anchor: ${String(anchor)} (use 1–31 or 'last')`);
  }
  return n;
}

/**
 * Next occurrence of `anchor` strictly after `fromMs`, in the user's local time.
 * anchor: 1..31, or 'last' (last day of the month); a day past the month's end
 * clamps to the last day (e.g. 31 → Feb 28).
 *
 * Returns null only if no occurrence is found within 24 months, which cannot
 * happen for a validated anchor — callers should treat null as a bug.
 */
export function nextOccurrence(fromMs, anchor, { hour = 9, utcOffsetMinutes = 0 } = {}) {
  validateAnchor(anchor);
  const from = Number(fromMs);
  if (!Number.isFinite(from)) throw new TypeError('fromMs must be a finite timestamp');
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) throw new RangeError('hour must be 0–23');
  if (!Number.isFinite(utcOffsetMinutes)) throw new RangeError('utcOffsetMinutes must be a number');

  const offsetMs = utcOffsetMinutes * 60 * 1000;
  const local = new Date(from + offsetMs);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth() + 1; // 1-12

  for (let i = 0; i < 24; i++) {
    const last = lastDayOfMonth(year, month);
    const day = anchor === 'last' ? last : Math.min(Number(anchor), last);
    const candidateLocal = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
    const candidateUtc = candidateLocal - offsetMs;
    if (candidateUtc > from) return candidateUtc;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

/**
 * The standard payday reminder steps: 27th, last day of the month, then the 2nd.
 * Feed these into `worker.enroll({ stepDefs })`; the worker anchors each calendar
 * step after the previous one, so the order is always 27th → last → 2nd.
 */
export function paydaySteps({ days = [27, 'last', 2], hour = 9 } = {}) {
  return days.map((day, index) => ({
    id: `payday-${String(day)}`,
    position: index + 1,
    schedule: { type: 'calendar', day, hour },
  }));
}
