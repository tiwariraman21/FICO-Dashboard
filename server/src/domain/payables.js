// Payables: what we owe, what falls due, and what must not be paid late or paid twice.
//
// Two Indian rules shape this screen more than any SAP default does:
//
//  - MSMED Act, section 15: a micro or small enterprise must be paid within 45 days of
//    accepting the goods or services. Pay later and section 16 interest is owed, at three
//    times the RBI bank rate, compounded monthly.
//  - Income Tax Act, section 43B(h): the expense is deductible only in the year it is
//    actually paid if that payment was later than the MSMED deadline.
//
// The posting date stands in for the date of acceptance. That is the usual practical
// approximation; where a customer records acceptance separately, the SAP provider should
// read that field instead.

import { addDays, daysBetween } from './clock.js';
import { sum, round } from './format.js';

export const MSME_DAYS = 45;

function normalisedReference(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Possible duplicates: same vendor, same gross amount, and either the same reference once
// punctuation is ignored or posted within a week of each other. SAP's own check compares
// the reference exactly, which is why "BB/2231" and "BB-2231" both get through.
export function findDuplicates(items) {
  const pairs = [];
  const live = items.filter((i) => i.status !== 'paid');
  for (let a = 0; a < live.length; a += 1) {
    for (let b = a + 1; b < live.length; b += 1) {
      const x = live[a];
      const y = live[b];
      if (x.vendorId !== y.vendorId || Math.abs(x.gross - y.gross) > 1) continue;
      const sameRef = normalisedReference(x.vendorReference) === normalisedReference(y.vendorReference);
      const close = Math.abs(daysBetween(x.postingDate, y.postingDate)) <= 7;
      if (sameRef || close) {
        const [first, second] = x.postingDate <= y.postingDate ? [x, y] : [y, x];
        pairs.push({ first: first.docNo, second: second.docNo, sameRef, vendorId: x.vendorId, amount: x.gross });
      }
    }
  }
  return pairs;
}

export function assessPayables({ vendors, items, runs, today }) {
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const runFor = new Map();
  for (const r of runs) for (const d of r.items) runFor.set(d, r.id);

  const duplicates = findDuplicates(items);
  const duplicateOf = new Map(duplicates.map((d) => [d.second, d.first]));

  const open = items
    .filter((i) => i.status === 'open' || i.status === 'blocked')
    .map((i) => {
      const v = vendorById.get(i.vendorId) || {};
      const daysSincePosting = daysBetween(i.postingDate, today);
      const msme = v.msmeCategory === 'micro' || v.msmeCategory === 'small';
      const discountDate = i.discountDate || (v.discountTerms ? addDays(i.invoiceDate, v.discountTerms.withinDays) : null);
      const discount =
        v.discountTerms && discountDate && discountDate >= today
          ? { percent: v.discountTerms.percent, amount: round((i.gross * v.discountTerms.percent) / 100), by: discountDate }
          : null;
      return {
        ...i,
        vendorName: v.name || i.vendorId,
        msme,
        msmeCategory: v.msmeCategory || null,
        daysSincePosting,
        msmeDeadline: msme ? addDays(i.postingDate, MSME_DAYS) : null,
        msmeDaysLeft: msme ? MSME_DAYS - daysSincePosting : null,
        msmeBreached: msme && daysSincePosting > MSME_DAYS,
        dueIn: daysBetween(today, i.dueDate),
        overdue: i.dueDate < today,
        inRun: runFor.get(i.docNo) || null,
        duplicateOf: duplicateOf.get(i.docNo) || null,
        discount
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const summaries = vendors.map((v) => {
    const mine = open.filter((i) => i.vendorId === v.id);
    const unblocked = mine.filter((i) => i.status === 'open');
    const bankChangedDaysAgo = v.bankLastChangedAt ? daysBetween(v.bankLastChangedAt, today) : null;
    const paid = items.filter((i) => i.vendorId === v.id && i.status === 'paid' && daysBetween(i.clearingDate, today) <= 120);
    const paidLateDays = paid.length
      ? round(sum(paid, (i) => daysBetween(i.dueDate, i.clearingDate)) / paid.length, 1)
      : null;
    return {
      ...v,
      msme: v.msmeCategory === 'micro' || v.msmeCategory === 'small',
      open: sum(mine, 'gross'),
      openCount: mine.length,
      overdue: sum(unblocked.filter((i) => i.overdue), 'gross'),
      dueNext7: sum(unblocked.filter((i) => !i.overdue && i.dueIn <= 7), 'gross'),
      blocked: sum(mine.filter((i) => i.status === 'blocked'), 'gross'),
      msmeBreaches: mine.filter((i) => i.msmeBreached).length,
      msmeAtRisk: mine.filter((i) => i.msme && !i.msmeBreached && i.msmeDaysLeft <= 7).length,
      inRun: sum(mine.filter((i) => i.inRun), 'net'),
      bankChangedDaysAgo,
      bankChangedRecently: bankChangedDaysAgo !== null && bankChangedDaysAgo <= 30,
      // How we have been paying them: positive means after the due date.
      ourAverageDaysLate: paidLateDays
    };
  });

  const history = {};
  for (const i of items) {
    const k = `${i.companyCode}|${i.postingDate.slice(0, 7)}`;
    history[k] = history[k] || { companyCode: i.companyCode, month: i.postingDate.slice(0, 7), invoiced: 0, paid: 0 };
    history[k].invoiced += i.gross;
    if (i.status === 'paid') {
      const p = `${i.companyCode}|${i.clearingDate.slice(0, 7)}`;
      history[p] = history[p] || { companyCode: i.companyCode, month: i.clearingDate.slice(0, 7), invoiced: 0, paid: 0 };
      history[p].paid += i.net;
    }
  }

  // Purchases in the last 90 days, by unit, so the browser can work out DPO per filter.
  const purchases90 = {};
  for (const i of items) {
    if (daysBetween(i.postingDate, today) <= 90) purchases90[i.companyCode] = (purchases90[i.companyCode] || 0) + i.gross;
  }

  return {
    vendors: summaries.sort((a, b) => b.open - a.open),
    openItems: open,
    duplicates,
    history: Object.values(history).sort((a, b) => a.month.localeCompare(b.month)),
    purchases90
  };
}
