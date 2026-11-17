// Receivables: who owes us what, how late they usually are, and who to chase first.
//
// Everything here is worked out from two plain lists - customer master data and customer
// line items, open and cleared - so it reads the same from the sample files as it will from
// SAP's operational accounting document items.

import { addDays, daysBetween } from './clock.js';
import { money, plural, round, sum, dmy } from './format.js';

export const BUCKETS = [
  { key: 'notDue', label: 'Not yet due' },
  { key: 'd1_30', label: '1 to 30 days' },
  { key: 'd31_60', label: '31 to 60 days' },
  { key: 'd61_90', label: '61 to 90 days' },
  { key: 'd90', label: 'Over 90 days' }
];

export function bucketFor(daysOverdue) {
  if (daysOverdue <= 0) return 'notDue';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90';
}

// The reminder a customer has earned, from their oldest overdue item. Mirrors a typical
// three-level dunning procedure: a polite note, a firm one, then a final notice.
export function reminderLevelFor(oldestOverdueDays) {
  if (oldestOverdueDays > 45) return 3;
  if (oldestOverdueDays > 15) return 2;
  if (oldestOverdueDays > 0) return 1;
  return 0;
}

const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));

// Amount-weighted average of how many days after the due date a customer actually paid.
function averageDaysLate(cleared) {
  const weight = sum(cleared, 'amount');
  if (!weight) return null;
  return round(sum(cleared, (i) => daysBetween(i.dueDate, i.clearingDate) * i.amount) / weight, 1);
}

function promiseStatus(promise, cleared, today) {
  // What came in after the promise was made, up to three days after the promised date.
  const window = cleared.filter(
    (i) => i.clearingDate >= promise.recordedAt.slice(0, 10) && i.clearingDate <= addDays(promise.promisedFor, 3)
  );
  const received = sum(window, 'amount');
  if (received >= promise.amount * 0.9) return { status: 'kept', received };
  if (promise.promisedFor < today) return { status: 'broken', received };
  return { status: 'due', received };
}

export function assessReceivables({ customers, items, promises, reminders, today }) {
  const byCustomer = new Map(customers.map((c) => [c.id, { ...c }]));

  const openItems = items
    .filter((i) => i.status === 'open' && i.openAmount > 0)
    .map((i) => {
      const daysOverdue = daysBetween(i.dueDate, today);
      return {
        ...i,
        customerName: byCustomer.get(i.customerId)?.name || i.customerId,
        daysOverdue,
        bucket: bucketFor(daysOverdue)
      };
    });

  const assessed = [...byCustomer.values()].map((c) => {
    const mine = openItems.filter((i) => i.customerId === c.id);
    const cleared = items.filter((i) => i.customerId === c.id && i.status === 'cleared');
    const clearedRecent = cleared.filter((i) => daysBetween(i.clearingDate, today) <= 180);

    const buckets = emptyBuckets();
    for (const i of mine) buckets[i.bucket] += i.openAmount;

    const exposure = sum(mine, 'openAmount');
    const overdueItems = mine.filter((i) => i.daysOverdue > 0);
    const overdue = sum(overdueItems, 'openAmount');
    const oldestOverdueDays = overdueItems.reduce((m, i) => Math.max(m, i.daysOverdue), 0);
    const disputed = sum(mine.filter((i) => i.disputed), 'openAmount');

    const avgLate = averageDaysLate(clearedRecent);
    const lateLast60 = averageDaysLate(cleared.filter((i) => daysBetween(i.clearingDate, today) <= 60));
    const lateBefore = averageDaysLate(
      cleared.filter((i) => daysBetween(i.clearingDate, today) > 60 && daysBetween(i.clearingDate, today) <= 180)
    );
    let trend = 'steady';
    if (lateLast60 !== null && lateBefore !== null) {
      if (lateLast60 - lateBefore > 5) trend = 'paying slower';
      else if (lateBefore - lateLast60 > 5) trend = 'paying faster';
    }
    // A customer who has stopped paying altogether has no recent clearing to be slow with.
    if (!cleared.some((i) => daysBetween(i.clearingDate, today) <= 60) && overdue > 0) trend = 'stopped paying';

    const billed90 = sum(items.filter((i) => i.customerId === c.id && daysBetween(i.invoiceDate, today) <= 90), 'amount');
    const dso = billed90 > 0 ? Math.round(exposure / (billed90 / 90)) : null;

    const myPromises = promises
      .filter((p) => p.customerId === c.id)
      .map((p) => ({ ...p, ...promiseStatus(p, cleared, today) }))
      .sort((a, b) => b.promisedFor.localeCompare(a.promisedFor));

    const myReminders = reminders.filter((r) => r.customerId === c.id).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const lastReminder = myReminders[0] || null;

    const creditUsedPercent = c.creditLimit > 0 ? Math.round((exposure / c.creditLimit) * 100) : null;
    const overLimitBy = Math.max(0, exposure - c.creditLimit);

    // Why this customer is worth a look, in the order somebody would say it out loud.
    const reasons = [];
    if (overLimitBy > 0) reasons.push(`over credit limit by ${money(overLimitBy)}`);
    if (buckets.d90 > 0) reasons.push(`${money(buckets.d90)} over 90 days`);
    const broken = myPromises.find((p) => p.status === 'broken');
    if (broken) reasons.push(`broke a promise to pay ${money(broken.amount)} by ${dmy(broken.promisedFor, false)}`);
    if (trend === 'stopped paying') reasons.push('nothing received in 60 days');
    else if (trend === 'paying slower') reasons.push(`paying slower: ${lateLast60} days late lately, ${lateBefore} before`);
    if (disputed > 0) reasons.push(`${money(disputed)} in dispute`);
    if (!reasons.length && overdue > 0) reasons.push(`${money(overdue)} overdue, oldest ${oldestOverdueDays} days`);

    let band = 'good';
    if (overLimitBy > 0 || buckets.d90 > 0 || broken || trend === 'stopped paying') band = 'high';
    else if (overdue > exposure * 0.2 || (avgLate !== null && avgLate > 20) || trend === 'paying slower' || disputed > 0) band = 'watch';

    return {
      ...c,
      exposure,
      overdue,
      buckets,
      oldestOverdueDays,
      openCount: mine.length,
      overdueCount: overdueItems.length,
      disputed,
      averageDaysLate: avgLate,
      trend,
      dso,
      creditUsedPercent,
      overLimitBy,
      promises: myPromises,
      lastReminder,
      reminderLevel: reminderLevelFor(oldestOverdueDays),
      band,
      bandLabel: band === 'high' ? 'Act now' : band === 'watch' ? 'Watch' : 'Good',
      reasons,
      // How much of what is owed we expect to actually arrive, for the cash forecast.
      collectionRate: band === 'high' ? 0.6 : band === 'watch' ? 0.85 : 0.97
    };
  });

  // Billing and collections by month and unit, for the trend chart.
  const history = {};
  for (const i of items) {
    const billedKey = `${i.companyCode}|${i.invoiceDate.slice(0, 7)}`;
    history[billedKey] = history[billedKey] || { companyCode: i.companyCode, month: i.invoiceDate.slice(0, 7), billed: 0, collected: 0 };
    history[billedKey].billed += i.amount;
    if (i.status === 'cleared') {
      const key = `${i.companyCode}|${i.clearingDate.slice(0, 7)}`;
      history[key] = history[key] || { companyCode: i.companyCode, month: i.clearingDate.slice(0, 7), billed: 0, collected: 0 };
      history[key].collected += i.amount;
    }
  }

  // Worst first: act-now customers, then by overdue value.
  const rank = { high: 0, watch: 1, good: 2 };
  assessed.sort((a, b) => rank[a.band] - rank[b.band] || b.overdue - a.overdue);

  return {
    customers: assessed,
    openItems: openItems.sort((a, b) => b.daysOverdue - a.daysOverdue),
    history: Object.values(history).sort((a, b) => a.month.localeCompare(b.month))
  };
}

// One line about a customer for a mail or the assistant.
export function customerLine(c) {
  return `${c.name}: owes ${money(c.exposure)}, ${money(c.overdue)} overdue across ${plural(c.overdueCount, 'invoice')}`;
}
