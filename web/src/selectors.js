// Small pure functions over the dashboard payload. Every screen filters by the company
// code chosen at the top, so that one rule lives here.

export function byUnit(rows, unit) {
  if (!unit || unit === 'all') return rows;
  return rows.filter((r) => r.companyCode === unit);
}

export function sum(rows, pick) {
  return rows.reduce((t, r) => t + (Number(typeof pick === 'function' ? pick(r) : r[pick]) || 0), 0);
}

export function waitingForMe(approvals, unit) {
  return byUnit(approvals, unit).filter((d) => d.status === 'with-you');
}

export function openProblems(problems, unit) {
  return byUnit(problems, unit).filter((p) => !p.fixed);
}

export function unitName(data, code) {
  if (!code || code === 'all') return 'all units';
  return data.companyCodes.find((c) => c.code === code)?.name || code;
}

// The cash forecast for the chosen unit, or all units added together week by week.
export function cashFor(data, unit) {
  const codes = unit === 'all' ? data.companyCodes.map((c) => c.code) : [unit];
  const fs = codes.map((c) => data.cash[c]);
  const weeks = fs[0].weeks.map((w, i) => {
    const lines = {};
    for (const f of fs) {
      for (const l of f.weeks[i].lines) {
        const key = `${l.kind}|${l.what}`;
        lines[key] = lines[key] || { ...l, amount: 0 };
        lines[key].amount += l.amount;
      }
    }
    return {
      ...w,
      inflow: sum(fs, (f) => f.weeks[i].inflow),
      outflow: sum(fs, (f) => f.weeks[i].outflow),
      net: sum(fs, (f) => f.weeks[i].net),
      closing: sum(fs, (f) => f.weeks[i].closing),
      headroom: sum(fs, (f) => f.weeks[i].headroom),
      lines: Object.values(lines).sort((a, b) => b.amount - a.amount)
    };
  });
  return {
    opening: sum(fs, 'opening'),
    facility: sum(fs, 'facility'),
    weeks,
    short: fs.filter((f) => f.firstShortWeek).map((f) => ({ companyCode: f.companyCode, week: f.firstShortWeek })),
    blockedValue: sum(fs, 'blockedValue'),
    blockedCount: sum(fs, 'blockedCount')
  };
}

// Receivables totals for the chosen unit.
export function receivablesFor(data, unit) {
  const items = byUnit(data.receivables.openItems, unit);
  const customers = byUnit(data.receivables.customers, unit);
  const total = sum(items, 'openAmount');
  const overdue = sum(items.filter((i) => i.daysOverdue > 0), 'openAmount');
  const buckets = {};
  for (const i of items) buckets[i.bucket] = (buckets[i.bucket] || 0) + i.openAmount;
  // DSO across the unit: what is owed, over average daily billing in the last 90 days.
  const daily = sum(customers, (c) => (c.dso ? c.exposure / c.dso : 0));
  return { items, customers, total, overdue, buckets, dso: daily ? Math.round(total / daily) : null };
}

export function payablesFor(data, unit) {
  const items = byUnit(data.payables.openItems, unit);
  const open = items.filter((i) => i.status === 'open');
  const total = sum(items, 'gross');
  const purchases = unit === 'all' ? sum(Object.values(data.payables.purchases90), (v) => v) : data.payables.purchases90[unit] || 0;
  return {
    items,
    total,
    overdue: sum(open.filter((i) => i.overdue), 'gross'),
    dueWeek: sum(open.filter((i) => !i.overdue && i.dueIn <= 7), 'gross'),
    blocked: items.filter((i) => i.status === 'blocked'),
    msmeBreached: items.filter((i) => i.msmeBreached),
    msmeAtRisk: items.filter((i) => i.msme && !i.msmeBreached && i.msmeDaysLeft <= 10),
    discounts: open.filter((i) => i.discount && i.discount.amount >= 50000),
    dpo: purchases ? Math.round(total / (purchases / 90)) : null
  };
}

export function closeFor(data, unit) {
  const tasks = byUnit(data.close.tasks, unit);
  return {
    tasks,
    done: tasks.filter((t) => t.status === 'done').length,
    late: tasks.filter((t) => t.late),
    blocked: tasks.filter((t) => t.status === 'blocked'),
    waitingOnYou: tasks.filter((t) => t.waitingOnYou)
  };
}
