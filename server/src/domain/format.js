// Small helpers for the sentences the backend writes itself (checks, problems, mail).
// The browser has its own copy in web/src/format.js; two small copies beat the backend
// sending half-built sentences for the browser to finish.

// Indian numbering: 1 crore = 10,000,000 and 1 lakh = 100,000.
export function money(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 10000000) return `${sign}₹${(a / 10000000).toFixed(2)} cr`;
  if (a >= 100000) return `${sign}₹${(a / 100000).toFixed(1)} L`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
}

export function rupees(value) {
  return `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
}

export function plural(count, word, pluralWord) {
  return `${count} ${count === 1 ? word : pluralWord || `${word}s`}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-09" -> "9 Nov 2026". Dates are handled as plain YYYY-MM-DD strings throughout,
// because a ledger date has no time zone and turning it into one invites off-by-one days.
export function dmy(iso, withYear = true) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

export function sum(rows, pick) {
  return rows.reduce((total, row) => total + (Number(typeof pick === 'function' ? pick(row) : row[pick]) || 0), 0);
}

export function round(n, places = 0) {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
}
