// An eight-week cash forecast, built bottom-up from the ledgers.
//
// Money in:  each open customer invoice, on its due date pushed out by how late that customer
//            usually pays, and discounted by how likely they are to pay at all. Overdue items
//            are expected a week from today. Disputed items are left out.
// Money out: every open supplier invoice on its due date (overdue ones this week), anything
//            in a payment proposal on the run date, and the fixed monthly outflows -
//            salaries, TDS, PF, GST and loan instalments.
// Blocked invoices are left out and shown separately, because releasing one is a decision
// still to be made.
//
// It is a forecast, and says so on screen. Its value is in showing which week gets tight and
// why, not in the rupee.

import { addDays, daysBetween } from './clock.js';
import { sum } from './format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function label(startIso, endIso) {
  const [, sm, sd] = startIso.split('-').map(Number);
  const [, em, ed] = endIso.split('-').map(Number);
  return sm === em ? `${sd}–${ed} ${MONTHS[em - 1]}` : `${sd} ${MONTHS[sm - 1]}–${ed} ${MONTHS[em - 1]}`;
}

function recurringDates(dayOfMonth, fromIso, toIso) {
  const out = [];
  let [y, m] = fromIso.split('-').map(Number);
  for (let i = 0; i < 4; i += 1) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
    if (iso >= fromIso && iso <= toIso) out.push(iso);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function buildCashForecast({ companyCodes, bankAccounts, receivables, payables, runs, approvals, recurring, today, weeks = 8 }) {
  const end = addDays(today, weeks * 7 - 1);
  const weekOf = (iso) => Math.max(0, Math.min(weeks - 1, Math.floor(daysBetween(today, iso) / 7)));
  const customerById = new Map(receivables.customers.map((c) => [c.id, c]));

  const runStatus = new Map(approvals.filter((a) => a.kind === 'RUN').map((a) => [a.id, a.status]));
  const liveRuns = runs.filter((r) => runStatus.get(r.id) !== 'rejected');
  const inRun = new Map();
  for (const r of liveRuns) for (const d of r.items) inRun.set(d, r);

  const forecasts = {};
  for (const cc of companyCodes.map((c) => c.code)) {
    const accounts = bankAccounts.filter((a) => a.companyCode === cc);
    const opening = sum(accounts, 'balance');
    const facility = sum(accounts, 'limit');

    const buckets = Array.from({ length: weeks }, (_, i) => {
      const start = addDays(today, i * 7);
      const stop = addDays(start, 6);
      return { index: i, start, end: stop, label: label(start, stop), inflow: 0, outflow: 0, lines: [] };
    });
    const add = (iso, field, amount, what) => {
      if (iso > end || amount <= 0) return;
      const b = buckets[weekOf(iso)];
      b[field] += amount;
      const existing = b.lines.find((l) => l.what === what && l.kind === field);
      if (existing) existing.amount += amount;
      else b.lines.push({ kind: field, what, amount });
    };

    for (const item of receivables.openItems.filter((i) => i.companyCode === cc && !i.disputed)) {
      const c = customerById.get(item.customerId);
      const late = Math.max(0, Math.round(c?.averageDaysLate || 0));
      // Already later than this customer usually pays: expect it soon from a good payer,
      // later from one we are chasing.
      let expected = addDays(item.dueDate, late);
      if (expected < today) expected = addDays(today, c?.band === 'good' ? 3 : c?.band === 'watch' ? 7 : 21);
      add(expected, 'inflow', item.openAmount * (c?.collectionRate ?? 0.9), c?.name || item.customerId);
    }

    for (const item of payables.openItems.filter((i) => i.companyCode === cc && i.status === 'open')) {
      const run = inRun.get(item.docNo);
      if (run) add(run.runDate, 'outflow', item.net, `Payment run ${run.runId}`);
      else add(item.dueDate < today ? today : item.dueDate, 'outflow', item.net, item.vendorName);
    }

    for (const r of recurring) {
      const amount = r.amounts[cc] || 0;
      for (const iso of recurringDates(r.dayOfMonth, today, end)) add(iso, 'outflow', amount, r.label);
    }

    let running = opening;
    for (const b of buckets) {
      b.net = b.inflow - b.outflow;
      b.opening = running;
      running += b.net;
      b.closing = running;
      b.headroom = running + facility;
      b.lines.sort((x, y) => y.amount - x.amount);
      b.lines = b.lines.slice(0, 8);
    }

    const lowest = buckets.reduce((low, b) => (b.closing < low.closing ? b : low), buckets[0]);
    const blocked = payables.openItems.filter((i) => i.companyCode === cc && i.status === 'blocked');

    forecasts[cc] = {
      companyCode: cc,
      opening,
      facility,
      weeks: buckets,
      lowest: { label: lowest.label, closing: lowest.closing, headroom: lowest.headroom },
      firstShortWeek: buckets.find((b) => b.headroom < 0)?.label || null,
      blockedValue: sum(blocked, 'net'),
      blockedCount: blocked.length
    };
  }

  return forecasts;
}
