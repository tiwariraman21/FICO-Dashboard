// Turning numbers, dates and names into something a controller reads without effort.

// Indian numbering, short form: 1 crore = 10,000,000, 1 lakh = 100,000.
export function inr(value) {
  if (value === null || value === undefined || value === '') return '–';
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 10000000) return `${sign}₹${(a / 10000000).toFixed(2)} cr`;
  if (a >= 100000) return `${sign}₹${(a / 100000).toFixed(1)} L`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
}

// The exact figure, for a journal line or an invoice where rounding would hide what matters.
export function rupees(value) {
  if (value === null || value === undefined) return '–';
  return `₹${Math.round(Number(value)).toLocaleString('en-IN')}`;
}

export function num(value) {
  if (value === null || value === undefined || value === '') return '–';
  return Number(value).toLocaleString('en-IN');
}

export function pct(value, places = 1) {
  if (value === null || value === undefined) return '–';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(places)}%`;
}

export function plural(count, word, pluralWord) {
  return `${count} ${count === 1 ? word : pluralWord || `${word}s`}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-09" -> "9 Nov 2026". Ledger dates are plain strings with no time zone.
export function dmy(iso, withYear = true) {
  if (!iso) return '–';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

export function monthLabel(yyyyMm) {
  const [, m] = String(yyyyMm).split('-').map(Number);
  return MONTHS[m - 1] || yyyyMm;
}

// A stored timestamp, in Indian time: "7 Nov, 16:20".
export function when(ts) {
  if (!ts) return '–';
  const s = String(ts);
  const d = new Date(s.includes('Z') || s.includes('+') ? s : `${s}+05:30`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function hoursLabel(h) {
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function loosely(text) {
  return String(text ?? '').toLowerCase().replace(/[\s\-.,/#]/g, '');
}

export function initials(name) {
  const parts = String(name).replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, '').replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  return ((parts[0] || '?').charAt(0) + (parts[1] ? parts[1].charAt(0) : '')).toUpperCase();
}

export function clock() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function firstName(fullName) {
  return String(fullName || '').replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, '').split(' ')[0];
}

// Business words to stylesheet tones, in one place.
export function bandTone(band) {
  if (band === 'good') return 'pos';
  if (band === 'watch') return 'warn';
  if (band === 'high') return 'neg';
  return 'mut';
}
