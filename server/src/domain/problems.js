// Problems found: the checks a careful controller would run every morning, run for them.
//
// Each rule reads the same assessed data the screens show, so a problem can always be
// traced to a row somebody can open. Nothing here is a model's opinion.
//
// A problem has an owner - the person who would actually fix it - and one suggested fix.
// Pressing the fix records it here and tells the owner by mail. It does not change SAP:
// blocking an invoice or putting a customer on credit hold is still done in SAP by the
// person named, and the note says exactly what to do.

import { money, plural, dmy, sum, round } from './format.js';
import { daysBetween } from './clock.js';

// Discounts smaller than this are not worth a line on the problems list.
export const MIN_DISCOUNT = 50000;

// The order problems are listed in, within a severity: money leaving wrongly first.
const TYPE_ORDER = ['bank-change', 'duplicate', 'cash', 'msme', 'customer', 'journal', 'budget', 'discount', 'dispute', 'grir', 'close'];

// How many days before the due date a discounted payment goes out.
function daysEarly(item, today) {
  const payOn = item.discount.by < today ? today : item.discount.by;
  return Math.max(1, daysBetween(payOn, item.dueDate));
}

// The return on paying early, as a yearly rate: the usual way to judge a cash discount.
function annualised(percent, days) {
  return round((percent / (100 - percent)) * (365 / days) * 100, 0);
}

export function findProblems({ receivables, payables, approvals, budgets, close, grir, vendors, meta, fixes, today }) {
  const people = meta.people;
  const problems = [];
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const liveRuns = approvals.filter((a) => a.kind === 'RUN' && a.status !== 'rejected');

  const add = (p) => problems.push(p);

  // 1. Duplicate supplier invoices.
  for (const d of payables.duplicates) {
    const a = payables.openItems.find((i) => i.docNo === d.first);
    const b = payables.openItems.find((i) => i.docNo === d.second);
    if (!a || !b) continue;
    const bothInRun = a.inRun && b.inRun;
    add({
      id: `duplicate:${d.second}`,
      type: 'duplicate',
      typeLabel: 'Possible duplicate payment',
      severity: 'high',
      companyCode: b.companyCode,
      value: d.amount,
      title: `${a.vendorName} invoice entered twice, ${money(d.amount)}`,
      detail: `${a.vendorReference} posted ${dmy(a.postingDate, false)} and ${b.vendorReference} posted ${dmy(b.postingDate, false)}: same vendor, same amount, same order.` +
        (bothInRun ? ' Both are in tomorrow’s payment run.' : ''),
      evidence: [
        `Document ${a.docNo}: ${a.vendorReference}, invoice date ${dmy(a.invoiceDate)}, ${money(a.gross)}${a.inRun ? `, in run ${a.inRun}` : ''}`,
        `Document ${b.docNo}: ${b.vendorReference}, invoice date ${dmy(b.invoiceDate)}, ${money(b.gross)}${b.inRun ? `, in run ${b.inRun}` : ''}`,
        d.sameRef ? 'References are identical once punctuation is ignored.' : 'Posted within a week of each other.',
        'SAP’s duplicate check compares the reference exactly, so a changed slash lets the second one through.'
      ],
      owner: people.ap,
      fix: { label: 'Block the second copy for payment', instruction: `Set payment block on document ${b.docNo} and take it out of the run; ask ${a.vendorName} to confirm only one invoice was raised.` },
      link: { screen: 'payables' }
    });
  }

  // 2. Bank details changed shortly before a payment.
  for (const v of vendors.filter((x) => x.bankChangedRecently)) {
    const lines = payables.openItems.filter((i) => i.vendorId === v.id && i.inRun);
    if (!lines.length) continue;
    add({
      id: `bank-change:${v.id}:${v.bankLastChangedAt}`,
      type: 'bank-change',
      typeLabel: 'Bank details changed before a payment',
      severity: 'high',
      companyCode: lines[0].companyCode,
      value: sum(lines, 'net'),
      title: `${v.name} changed bank account ${plural(v.bankChangedDaysAgo, 'day')} ago, ${money(sum(lines, 'net'))} about to go to it`,
      detail: 'Changing a supplier’s bank account by email shortly before a large payment is the most common invoice fraud pattern. The change should be confirmed by calling a number already on file, not one in the email.',
      evidence: [
        `Account changed on ${dmy(v.bankLastChangedAt)}: was ****${v.previousBankAccountLast4 || '????'}, now ****${v.bankAccountLast4}`,
        `Changed by ${v.bankChangedBy || 'not recorded'}`,
        ...lines.map((l) => `${l.vendorReference}, ${money(l.net)}, in run ${l.inRun}`)
      ],
      owner: people.treasury,
      fix: { label: 'Hold their payments until confirmed', instruction: `Take ${v.name} out of run ${lines[0].inRun} and call them on the number in the vendor master from before ${dmy(v.bankLastChangedAt, false)} to confirm the new account.` },
      link: { screen: 'approvals', id: lines[0].inRun }
    });
  }

  // 3. MSME invoices past 45 days that nothing is going to pay.
  for (const i of payables.openItems.filter((x) => x.msmeBreached && !x.inRun)) {
    add({
      id: `msme:${i.docNo}`,
      type: 'msme',
      typeLabel: 'MSME invoice past 45 days',
      severity: 'high',
      companyCode: i.companyCode,
      value: i.gross,
      title: `${i.vendorName}, ${money(i.gross)}, ${i.daysSincePosting} days since acceptance and in no payment run`,
      detail: 'A micro or small enterprise must be paid within 45 days. Past that, interest is owed under section 16 of the MSMED Act at three times the RBI bank rate, compounded monthly, and that interest is never tax-deductible.',
      evidence: [
        `${i.vendorName} is registered as a ${i.msmeCategory} enterprise`,
        `Invoice ${i.vendorReference}, posted ${dmy(i.postingDate)}, 45-day limit was ${dmy(i.msmeDeadline)}`,
        i.status === 'blocked' ? `Blocked: ${i.blockReason}` : 'Not blocked, simply left out of the last run'
      ],
      owner: people.ap,
      fix: { label: 'Add it to the next payment run', instruction: `Include ${i.vendorReference} in the next run for unit ${i.companyCode}, and record the interest owed for the MSME-1 half-yearly return.` },
      link: { screen: 'payables' }
    });
  }

  // 4. Customers who need action now.
  for (const c of receivables.customers.filter((x) => x.band === 'high')) {
    const overLimit = c.overLimitBy > 0;
    add({
      id: `customer:${c.id}`,
      type: 'customer',
      typeLabel: overLimit ? 'Customer over credit limit' : 'Customer not paying',
      severity: overLimit || c.buckets.d90 > 0 ? 'high' : 'medium',
      companyCode: c.companyCode,
      value: c.overdue,
      title: `${c.name}: ${c.reasons[0]}`,
      detail: `Owes ${money(c.exposure)} against a limit of ${money(c.creditLimit)}; ${money(c.overdue)} is overdue, the oldest by ${c.oldestOverdueDays} days.`,
      evidence: c.reasons.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).concat(
        c.lastReminder ? [`Last reminder: level ${c.lastReminder.level}, sent ${dmy(c.lastReminder.sentAt.slice(0, 10))}`] : ['No reminder sent yet']
      ),
      owner: people.ar,
      fix: overLimit
        ? { label: 'Put them on credit hold', instruction: `Block new sales orders for ${c.name} in credit management until the overdue ${money(c.overdue)} is cleared or the limit is reviewed.` }
        : { label: 'Escalate to the account manager', instruction: `${c.accountManager} to call ${c.contact} this week and agree a dated payment plan for ${money(c.overdue)}.` },
      link: { screen: 'receivables', id: c.id }
    });
  }

  // 5. Disputes left open too long.
  for (const i of receivables.openItems.filter((x) => x.disputed && x.daysOverdue > 14)) {
    add({
      id: `dispute:${i.docNo}`,
      type: 'dispute',
      typeLabel: 'Dispute open too long',
      severity: 'medium',
      companyCode: i.companyCode,
      value: i.openAmount,
      title: `${i.customerName} dispute on ${money(i.openAmount)}, ${i.daysOverdue} days past due`,
      detail: i.disputeNote,
      evidence: [`Invoice ${i.docNo} dated ${dmy(i.invoiceDate)}, due ${dmy(i.dueDate)}`],
      owner: people.ar,
      fix: { label: 'Chase the plant for the weighbridge slips', instruction: 'Ask the plant to send the weighbridge slips and gate passes for this invoice so the claim can be settled or rejected.' },
      link: { screen: 'receivables', id: i.customerId }
    });
  }

  // 6. Payment runs the bank cannot fund.
  for (const r of liveRuns) {
    if (r.detail.available >= r.amount) continue;
    add({
      id: `run-short:${r.id}`,
      type: 'cash',
      typeLabel: 'Not enough cash for a payment run',
      severity: 'high',
      companyCode: r.companyCode,
      value: r.amount - r.detail.available,
      title: `Run ${r.detail.runId} needs ${money(r.amount)}, unit has ${money(r.detail.available)}`,
      detail: 'The run would bounce or push the cash credit account past its limit.',
      evidence: [`Short by ${money(r.amount - r.detail.available)}`, `Paid from ${r.detail.bankAccount ? `${r.detail.bankAccount.bank} ****${r.detail.bankAccount.last4}` : 'unknown account'}`],
      owner: people.treasury,
      fix: { label: 'Ask treasury to fund or split the run', instruction: `Transfer at least ${money(r.amount - r.detail.available)} from Pune or Mumbai to the unit before ${dmy(r.detail.runDate)}, or move non-urgent lines to the next run.` },
      link: { screen: 'approvals', id: r.id }
    });
  }

  // 7. Early-payment discounts about to be lost.
  for (const i of payables.openItems.filter((x) => x.status === 'open' && x.discount && x.discount.amount >= MIN_DISCOUNT && !x.inRun)) {
    add({
      id: `discount:${i.docNo}`,
      type: 'discount',
      typeLabel: 'Discount about to expire',
      severity: 'medium',
      companyCode: i.companyCode,
      value: i.discount.amount,
      title: `${money(i.discount.amount)} discount from ${i.vendorName} expires ${dmy(i.discount.by, false)}`,
      detail: `Paying ${i.vendorReference} by ${dmy(i.discount.by)} earns ${i.discount.percent}%. That is ${daysEarly(i, today)} days early, which works out to about ${annualised(i.discount.percent, daysEarly(i, today))}% a year: far more than the money earns in the bank.`,
      evidence: [`Invoice ${money(i.gross)}, due ${dmy(i.dueDate)}`, 'Not in any payment proposal'],
      owner: people.ap,
      fix: { label: 'Pay it early', instruction: `Add ${i.vendorReference} to a run on or before ${dmy(i.discount.by)} with the discount taken.` },
      link: { screen: 'payables' }
    });
  }

  // 8. Journal entries that look wrong.
  for (const je of approvals.filter((a) => a.kind === 'JE' && a.status === 'with-you')) {
    const flags = je.checks.filter((c) => c.tone === 'neg');
    if (flags.length < 2) continue;
    add({
      id: `je:${je.id}`,
      type: 'journal',
      typeLabel: 'Unusual journal entry',
      severity: 'medium',
      companyCode: je.companyCode,
      value: je.amount,
      title: `${je.title}, ${money(je.amount)}, by ${je.preparedBy.name}`,
      detail: 'Several of the checks auditors run on manual entries fail at once.',
      evidence: flags.map((f) => f.text),
      owner: people.gl,
      fix: { label: 'Ask the preparer for support', instruction: `${je.preparedBy.name} to attach the working and whoever approved the change, and say why it was posted out of hours, before entry ${je.id} is approved.` },
      link: { screen: 'approvals', id: je.id }
    });
  }

  // 9. Old GR/IR items, per unit.
  for (const cc of meta.companyCodes) {
    const aged = grir.filter((g) => g.companyCode === cc.code && g.ageDays > 90);
    if (!aged.length) continue;
    const value = sum(aged, (g) => g.grValue + g.irValue);
    add({
      id: `grir:${cc.code}:${aged.length}`,
      type: 'grir',
      typeLabel: 'Old GR/IR balances',
      severity: 'medium',
      companyCode: cc.code,
      value,
      title: `${plural(aged.length, 'GR/IR item')} older than 90 days in ${cc.name}, ${money(value)}`,
      detail: 'Goods received but never invoiced, or invoiced but never received. Either the liability is overstated or something was not delivered.',
      evidence: aged.map(
        (g) => `PO ${g.poNumber}, ${vendorById.get(g.vendorId)?.name || g.vendorId}: ${g.kind}, ${money(g.grValue + g.irValue)}, ${g.ageDays} days, buyer ${g.buyer}`
      ),
      owner: people.ap,
      fix: { label: 'Ask buyers to clear or reverse', instruction: 'Each buyer to confirm whether the goods or invoice are still coming; anything that is not gets cleared with MR11.' },
      link: { screen: 'close' }
    });
  }

  // 10. Cost centres overspending.
  for (const b of budgets.filter((x) => x.status === 'over')) {
    add({
      id: `budget:${b.id}`,
      type: 'budget',
      typeLabel: 'Cost centre over budget',
      severity: b.variancePercent > 12 ? 'high' : 'medium',
      companyCode: b.companyCode,
      value: b.variance,
      title: `${b.name}, ${meta.companyCodes.find((c) => c.code === b.companyCode)?.name}: ${b.variancePercent}% over plan, ${money(b.variance)}`,
      detail: `At this rate the year ends ${money(b.forecastOver)} over its ${money(b.annualPlan)} budget. October alone ran ${b.lastMonthPercent}% over.`,
      evidence: [`Plan to date ${money(b.ytdPlan)}, actual ${money(b.ytdActual)}`, `Open commitments ${money(b.committed)}`],
      owner: { name: b.owner, title: `Owner, ${b.name}` },
      fix: { label: 'Ask the owner for a variance note', instruction: `${b.owner} to explain the overrun and say whether it continues, before the October management pack goes out.` },
      link: { screen: 'budgets', id: b.id }
    });
  }

  // 11. Close tasks that are late and stuck.
  for (const t of close.filter((x) => x.late && x.status === 'blocked')) {
    add({
      id: `close:${t.id}`,
      type: 'close',
      typeLabel: 'Close task stuck',
      severity: 'medium',
      companyCode: t.companyCode,
      value: 0,
      title: `${t.title}, unit ${t.companyCode}: due working day ${t.workingDay}, blocked`,
      detail: t.note,
      evidence: [`Owner ${t.owner}`, `Due ${dmy(t.dueDate)}`],
      owner: { name: t.owner, title: t.ownerTitle },
      fix: { label: 'Escalate it', instruction: `${t.owner} to escalate with the bank branch manager and confirm a date today.` },
      link: { screen: 'close' }
    });
  }

  // Fixed ones keep their place in the list, marked, so the morning's work is visible.
  const fixedById = new Map(fixes.map((f) => [f.problemId, f]));
  const sevRank = { high: 0, medium: 1 };
  return problems
    .map((p) => ({ ...p, fixed: fixedById.get(p.id) || null }))
    .sort((a, b) => Number(Boolean(a.fixed)) - Number(Boolean(b.fixed)) || sevRank[a.severity] - sevRank[b.severity] || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || b.value - a.value);
}
