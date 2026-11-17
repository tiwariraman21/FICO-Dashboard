// What "today" means.
//
// With live data, today is today. With the sample data, today is the day the data was
// built for (meta.asOf), so "47 days overdue" is still 47 days overdue next month. The
// screens say which, so nobody mistakes a frozen sample for a live ledger.

let asOf = null;

export function setAsOf(value) {
  asOf = value || null;
}

export function isFrozen() {
  return Boolean(asOf);
}

// YYYY-MM-DD
export function today() {
  if (asOf) return asOf;
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// The current moment as a Date. On sample data, the as-of day at 2.30 pm, so "hours
// waiting" on a parked entry is stable too.
export function now() {
  if (asOf) return new Date(`${asOf}T14:30:00+05:30`);
  return new Date();
}

// A real timestamp for a decision. Decisions are stamped with the actual time they were
// made, even on sample data: the audit trail must never be invented.
export function stamp() {
  return new Date().toISOString();
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso.slice(0, 10)}T00:00:00Z`) - new Date(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86400000);
}

// Local timestamps in the data ("2026-11-08T23:41:00") are Indian time.
export function hoursSince(localTimestamp) {
  const t = new Date(String(localTimestamp).includes('+') || String(localTimestamp).endsWith('Z') ? localTimestamp : `${localTimestamp}+05:30`);
  return Math.max(0, Math.round((now() - t) / 3600000));
}
