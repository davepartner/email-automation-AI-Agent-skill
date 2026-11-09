// Calendar-anchored scheduling for payday-cycle sequences (27th, last day, 2nd).
// Times are "local" to a supplied UTC offset (minutes); default offset 0 (UTC), hour 09:00.

export function lastDayOfMonth(year, month /* 1-12 */) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Next occurrence of `anchor` strictly after `fromMs`.
 * anchor: 1..31, or 'last' (last day of the month).
 */
export function nextOccurrence(fromMs, anchor, { hour = 9, utcOffsetMinutes = 0 } = {}) {
  const from = Number(fromMs);
  const offsetMs = utcOffsetMinutes * 60 * 1000;
  const local = new Date(from + offsetMs);
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth() + 1; // 1-12

  for (let i = 0; i < 24; i++) {
    const last = lastDayOfMonth(year, month);
    const day = anchor === 'last' ? last : Math.min(Math.max(1, Number(anchor)), last);
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
 * Feed these into `worker.enroll({ stepDefs })`.
 */
export function paydaySteps({ days = [27, 'last', 2], hour = 9 } = {}) {
  return days.map((day, index) => ({
    position: index + 1,
    schedule: { type: 'calendar', day, hour },
  }));
}
