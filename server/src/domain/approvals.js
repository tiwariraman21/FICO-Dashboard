// Everything waiting for a finance signature, in one list.
//
// Three kinds of document land on a Finance Controller's desk, and SAP shows each in a
// different place: parked journal entries, supplier invoices blocked for payment, and the
// payment proposal before it goes to the bank. Here they are one queue, each with the
// checks somebody would otherwise do by hand before signing.
//
// Every check is a plain sentence with a tone (pos, warn, neg). The worst tone becomes the
// document's tone. The checks are worked out from data; none of them is a guess.

import { config } from '../config.js';
import { hoursSince, daysBetween } from './clock.js';
import { money, rupees, plural, sum, dmy, round } from './format.js';

const TONE_RANK = { neg: 0, warn: 1, pos: 2, info: 3 };

function worstTone(checks) {
  return checks.reduce((worst, c) => (TONE_RANK[c.tone] < TONE_RANK[worst] ? c.tone : worst), 'pos');
}

// The approval chain for one document, with any decisions taken here laid over it.
function chain({ kind, id, preparedBy, preparedAt, needsCfo, me, cfo, decisions }) {
  const mine = decisions.filter((d) => d.kind === kind && d.docId === id);
  const controller = [...mine].reverse().find((d) => d.level === 'controller') || null;

  const steps = [
    { role: 'prepared', name: preparedBy.name, title: preparedBy.title, state: 'done', when: preparedAt, note: null },
    {
      role: 'controller',
      name: me.name,
      title: me.title,
      you: true,
      state: controller ? (controller.decision === 'approve' ? 'done' : 'rejected') : 'waiting',
      when: controller?.decidedAt || null,
      note: controller?.note || null
    }
  ];
  if (needsCfo) {
    steps.push({
      role: 'cfo',
      name: cfo.name,
      title: cfo.title,
      state: controller?.decision === 'approve' ? 'waiting' : 'pending',
      when: null,
      note: null
    });
  }

  let status = 'with-you';
  if (controller?.decision === 'reject') status = 'rejected';
  else if (controller?.decision === 'approve') status = needsCfo ? 'with-cfo' : 'approved';

  const statusLabel = {
    'with-you': 'Waiting for you',
    'with-cfo': `With ${cfo.name.replace(/^(Mr|Ms|Mrs|Dr)\.\s*/, '')}`,
    approved: kind === 'JE' ? 'Approved, posted' : kind === 'INV' ? 'Released for payment' : 'Released to the bank',
    rejected: 'Sent back'
  }[status];

  return { steps, status, statusLabel, decision: controller };
}

function isOutsideHours(localTimestamp) {
  const t = new Date(`${localTimestamp}+05:30`);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(t);
  const weekday = parts.find((p) => p.type === 'weekday').value;
  const hour = Number(parts.find((p) => p.type === 'hour').value);
  return { outside: weekday === 'Sun' || weekday === 'Sat' || hour < 8 || hour >= 21, weekday, hour };
}

function timeOf(localTimestamp) {
  return String(localTimestamp).slice(11, 16);
}

// --- Journal entries --------------------------------------------------------------------

function journalEntry(je, ctx) {
  const { glName, fiscal, closeTasks, customers } = ctx;
  const debit = sum(je.lines, 'debit');
  const credit = sum(je.lines, 'credit');
  const needsCfo = Boolean(je.needsCfo) || je.amount > config.limits.journalEntry;
  const checks = [];

  checks.push(
    Math.abs(debit - credit) < 1
      ? { tone: 'pos', text: `Debits and credits balance at ${money(debit)}.` }
      : { tone: 'neg', text: `Out of balance by ${rupees(Math.abs(debit - credit))}. SAP will not post this as it stands.` }
  );

  if (je.attachments === 0) checks.push({ tone: 'neg', text: 'No supporting document is attached.' });
  else checks.push({ tone: 'pos', text: `${plural(je.attachments, 'supporting document')} attached.` });

  const when = isOutsideHours(je.preparedAt);
  if (when.outside) {
    const dayName = { Sun: 'Sunday', Sat: 'Saturday' }[when.weekday];
    const late = when.hour >= 21 || when.hour < 6;
    checks.push({
      tone: 'neg',
      text: dayName
        ? `Prepared on a ${dayName}${late ? ' night' : ''}, at ${timeOf(je.preparedAt)}.`
        : `Prepared at ${timeOf(je.preparedAt)}, outside working hours.`
    });
  }

  const suspenseCredit = je.lines.find((l) => l.gl === '199999' && l.credit > 0);
  const suspenseDebit = je.lines.find((l) => l.gl === '199999' && l.debit > 0);
  if (suspenseCredit) checks.push({ tone: 'pos', text: `Clears ${money(suspenseCredit.credit)} out of the suspense account.` });
  if (suspenseDebit) checks.push({ tone: 'warn', text: `Puts ${money(suspenseDebit.debit)} into the suspense account, which should be empty at month end.` });

  // Crediting an expense account reduces cost and lifts profit. With no paperwork, that is
  // the pattern auditors look for first.
  const expenseCredit = je.lines.find((l) => l.credit > 0 && /^5/.test(l.gl));
  if (expenseCredit && je.type === 'Manual entry') {
    checks.push({
      tone: je.attachments === 0 ? 'neg' : 'warn',
      text: `Reduces ${glName(expenseCredit.gl).toLowerCase()} by ${money(expenseCredit.credit)}, which lifts October profit by the same amount.`
    });
  }

  if (je.type === 'Write-off') {
    const customerLine = je.lines.find((l) => l.gl === '140000');
    const custId = customerLine && /C\d{6}/.exec(customerLine.text || '')?.[0];
    const customer = custId && customers.find((c) => c.id === custId);
    checks.push({ tone: 'warn', text: 'Write-offs need the CFO as well as you, whatever the amount.' });
    if (customer) {
      checks.push({
        tone: customer.band === 'high' ? 'neg' : 'warn',
        text: `${customer.name} still owes ${money(customer.exposure)}, ${money(customer.overdue)} of it overdue. Writing off part of the balance before the rest is collected weakens the position for recovering it.`
      });
    }
  } else if (needsCfo) {
    checks.push({ tone: 'warn', text: `Above your ${money(config.limits.journalEntry)} limit, so the CFO signs after you.` });
  }

  if (je.reversal) checks.push({ tone: 'info', text: `${je.reversal}.` });
  checks.push({ tone: 'pos', text: `${fiscal.closingPeriodLabel} is still open for posting.` });

  const unblocks = closeTasks.filter((t) => (t.waitingOn || []).includes(je.docNo) && t.status !== 'done');

  return {
    kind: 'JE',
    kindLabel: 'Journal entry',
    id: je.docNo,
    companyCode: je.companyCode,
    title: je.title,
    subtitle: `${je.type}, period ${String(je.period).padStart(2, '0')}`,
    description: je.description,
    amount: je.amount,
    preparedBy: je.preparedBy,
    preparedAt: je.preparedAt,
    needsCfo,
    checks,
    unblocks: unblocks.map((t) => ({ id: t.id, title: t.title, companyCode: t.companyCode })),
    consequence: {
      ifApproved:
        `Posts ${money(je.amount)} to ${glName(je.lines[0].gl)} and ${glName(je.lines[1].gl)} in ${fiscal.closingPeriodLabel}` +
        (needsCfo ? ' once the CFO has also signed.' : '.') +
        (unblocks.length ? ` Unblocks the close task "${unblocks[0].title}".` : ''),
      ifRejected:
        `Goes back to ${je.preparedBy.name} unposted.` +
        (unblocks.length ? ` "${unblocks[0].title}" stays stuck until it comes back.` : '') +
        (je.type === 'Accrual' ? ` October costs would be understated by ${money(je.amount)}.` : '')
    },
    detail: {
      type: je.type,
      reversal: je.reversal,
      attachments: je.attachments,
      lines: je.lines.map((l) => ({ ...l, glName: glName(l.gl) }))
    }
  };
}

// --- Blocked supplier invoices -------------------------------------------------------------

function blockedInvoice(item, ctx) {
  const { vendorById, duplicates, today } = ctx;
  const v = vendorById.get(item.vendorId) || {};
  const needsCfo = item.gross > config.limits.invoiceRelease;
  const checks = [];
  const vr = item.variance || {};
  let difference = 0;

  if (vr.kind === 'price') {
    const pct = round(((vr.invoicePrice - vr.poPrice) / vr.poPrice) * 100, 2);
    difference = round((vr.invoicePrice - vr.poPrice) * vr.quantity);
    checks.push({
      tone: pct > vr.tolerancePercent ? 'neg' : 'warn',
      text: `Invoiced at ${rupees(vr.invoicePrice)} per ${vr.unit} against ${rupees(vr.poPrice)} on the order: ${pct}% over, against a ${vr.tolerancePercent}% tolerance. That is ${money(difference)} more on ${vr.quantity.toLocaleString('en-IN')} ${vr.unit}.`
    });
    if (vr.note) checks.push({ tone: 'info', text: vr.note });
  } else if (vr.kind === 'quantity') {
    const extra = vr.invoicedQuantity - vr.receivedQuantity;
    difference = round(extra * vr.invoicePrice);
    checks.push(
      extra > 0
        ? { tone: 'neg', text: `Invoiced for ${vr.invoicedQuantity.toLocaleString('en-IN')} ${vr.unit}, received ${vr.receivedQuantity.toLocaleString('en-IN')}. Releasing it pays ${money(difference)} for goods that have not arrived.` }
        : { tone: 'pos', text: `Invoice now matches the goods received: ${vr.receivedQuantity.toLocaleString('en-IN')} ${vr.unit}.` }
    );
    if (vr.note) checks.push({ tone: 'info', text: vr.note });
  } else if (vr.kind === 'receipt') {
    checks.push({ tone: 'warn', text: `No goods receipt or service entry against the order for ${money(vr.amountWithoutReceipt)}.` });
    if (vr.note) checks.push({ tone: 'info', text: vr.note });
  } else if (vr.kind === 'manual') {
    checks.push({ tone: 'warn', text: vr.note });
  }

  if (item.msme) {
    checks.push(
      item.msmeBreached
        ? { tone: 'neg', text: `MSME vendor, ${item.daysSincePosting} days since acceptance: past the 45-day limit. Interest under the MSMED Act is already running.` }
        : { tone: item.msmeDaysLeft <= 10 ? 'warn' : 'info', text: `MSME vendor (${item.msmeCategory}): must be paid by ${dmy(item.msmeDeadline)}, ${item.msmeDaysLeft} days from now.` }
    );
  }

  const dueIn = daysBetween(today, item.dueDate);
  checks.push({
    tone: dueIn < 0 ? 'warn' : 'info',
    text: dueIn < 0 ? `Due date was ${dmy(item.dueDate)}, ${-dueIn} days ago.` : `Due ${dmy(item.dueDate)}, in ${plural(dueIn, 'day')}.`
  });

  if (v.bankChangedRecently) {
    checks.push({ tone: 'neg', text: `${v.name} changed their bank account ${v.bankChangedDaysAgo} days ago. Confirm by phone before money goes to it.` });
  }
  const dup = duplicates.find((d) => d.first === item.docNo || d.second === item.docNo);
  if (dup) checks.push({ tone: 'neg', text: `Looks like a duplicate of invoice ${dup.first === item.docNo ? dup.second : dup.first}.` });
  if (needsCfo) checks.push({ tone: 'warn', text: `Above ${money(config.limits.invoiceRelease)}, so the CFO signs after you.` });

  const shouldWait = vr.kind === 'quantity' && difference > 0;
  return {
    kind: 'INV',
    kindLabel: 'Blocked invoice',
    id: item.docNo,
    companyCode: item.companyCode,
    title: `${item.vendorName}, ${item.vendorReference}`,
    subtitle: item.blockReason,
    description: `Supplier invoice against order ${item.poNumber || 'none'}, blocked for payment: ${item.blockReason.toLowerCase()}.`,
    amount: item.gross,
    preparedBy: { name: item.blockedBy, title: 'blocked the invoice' },
    preparedAt: item.blockedAt,
    needsCfo,
    checks,
    unblocks: [],
    consequence: {
      ifApproved: shouldWait
        ? `Releases the full ${money(item.gross)}, including ${money(difference)} for goods not received. A credit note would have to be chased afterwards.`
        : `Releases ${money(item.net)} for payment${needsCfo ? ' once the CFO has also signed' : ''}. It goes in the next payment run on or after ${dmy(item.dueDate)}.`,
      ifRejected: shouldWait
        ? `Stays blocked. ${item.blockedBy} asks ${item.vendorName} for a credit note of ${money(difference)}, then releases the rest.`
        : `Stays blocked, and ${item.blockedBy} tells ${item.vendorName} why.` +
          (item.msme && !item.msmeBreached ? ` Leave it past ${dmy(item.msmeDeadline)} and MSME interest starts.` : '')
    },
    detail: {
      vendorId: item.vendorId,
      vendorName: item.vendorName,
      vendorReference: item.vendorReference,
      poNumber: item.poNumber,
      invoiceDate: item.invoiceDate,
      postingDate: item.postingDate,
      dueDate: item.dueDate,
      gross: item.gross,
      tds: item.tds,
      net: item.net,
      blockReason: item.blockReason,
      variance: vr,
      difference
    }
  };
}

// --- Payment runs -------------------------------------------------------------------------

function paymentRun(run, ctx) {
  const { apByDoc, vendorById, bankAccounts, duplicates, openPayables, today } = ctx;
  const lines = run.items.map((d) => apByDoc.get(d)).filter(Boolean);
  const total = sum(lines, 'net');
  const needsCfo = total > config.limits.paymentRun;
  const checks = [];

  // Money available in the unit: positive balances plus whatever is undrawn on a cash
  // credit facility.
  const accounts = bankAccounts.filter((a) => a.companyCode === run.companyCode);
  const available = sum(accounts, (a) => (a.limit > 0 ? a.limit + a.balance : Math.max(0, a.balance)));
  const bank = bankAccounts.find((a) => a.id === run.bankAccountId);
  checks.push(
    total > available
      ? { tone: 'neg', text: `Needs ${money(total)}; the unit has ${money(available)} available including undrawn cash credit. Short by ${money(total - available)}.` }
      : { tone: 'pos', text: `Needs ${money(total)} of the ${money(available)} available in the unit.` }
  );

  const dupLines = duplicates.filter((p) => run.items.includes(p.second) || (run.items.includes(p.first) && run.items.includes(p.second)));
  for (const p of dupLines) {
    const a = apByDoc.get(p.first);
    const b = apByDoc.get(p.second);
    checks.push({
      tone: 'neg',
      text: `Possible duplicate: ${a.vendorName} ${money(p.amount)} entered twice, as ${a.vendorReference} and ${b.vendorReference}${run.items.includes(p.first) && run.items.includes(p.second) ? ', and both are in this run' : ''}.`
    });
  }

  const changedBank = [...new Set(lines.map((l) => l.vendorId))]
    .map((id) => vendorById.get(id))
    .filter((v) => v && v.bankChangedRecently);
  for (const v of changedBank) {
    const amount = sum(lines.filter((l) => l.vendorId === v.id), 'net');
    checks.push({
      tone: 'neg',
      text: `${v.name} changed their bank account ${plural(v.bankChangedDaysAgo, 'day')} ago (${v.bankChangedBy || 'no requester recorded'}). ${money(amount)} would go to the new account ending ${v.bankAccountLast4}.`
    });
  }

  const msmeOverdue = lines.filter((l) => l.msmeBreached);
  if (msmeOverdue.length) {
    checks.push({
      tone: 'pos',
      text: `Pays ${plural(msmeOverdue.length, 'MSME invoice')} already past 45 days (${msmeOverdue.map((l) => `${l.vendorName}, ${l.daysSincePosting} days`).join('; ')}). Interest is owed on ${msmeOverdue.length === 1 ? 'it' : 'them'} regardless.`
    });
  }
  const msmeLeftOut = openPayables.filter((l) => l.companyCode === run.companyCode && l.status === 'open' && l.msmeBreached && !run.items.includes(l.docNo));
  for (const l of msmeLeftOut) {
    checks.push({ tone: 'neg', text: `Leaves out ${l.vendorName} ${l.vendorReference}, an MSME invoice ${l.daysSincePosting} days old. Interest grows every day it waits.` });
  }
  const discountsMissed = openPayables.filter(
    (l) => l.companyCode === run.companyCode && l.status === 'open' && l.discount && l.discount.amount >= 50000 && !run.items.includes(l.docNo)
  );
  for (const l of discountsMissed) {
    checks.push({
      tone: 'warn',
      text: `${l.vendorName} offers ${l.discount.percent}% (${money(l.discount.amount)}) for paying ${l.vendorReference} by ${dmy(l.discount.by)}. It is not in this run.`
    });
  }

  const overdueLines = lines.filter((l) => l.overdue);
  checks.push({
    tone: 'info',
    text: `${plural(lines.length, 'invoice')} to ${plural(new Set(lines.map((l) => l.vendorId)).size, 'vendor')}, ${overdueLines.length} of them already past due. Paid from ${bank ? `${bank.bank} ****${bank.last4}` : run.bankAccountId} on ${dmy(run.runDate)}.`
  });
  if (needsCfo) checks.push({ tone: 'warn', text: `Above ${money(config.limits.paymentRun)}, so the CFO releases it after you.` });

  const hasBlockers = checks.some((c) => c.tone === 'neg');
  return {
    kind: 'RUN',
    kindLabel: 'Payment run',
    id: run.id,
    companyCode: run.companyCode,
    title: `Payment run ${run.runId}, ${dmy(run.runDate, false)}`,
    subtitle: `${plural(lines.length, 'invoice')}, ${bank ? bank.bank : ''}`,
    description: `Automatic payment proposal for ${dmy(run.runDate)}, prepared by ${run.preparedBy.name}.`,
    amount: total,
    preparedBy: run.preparedBy,
    preparedAt: run.preparedAt,
    needsCfo,
    checks,
    unblocks: [],
    consequence: {
      ifApproved: `${money(total)} leaves ${bank ? `${bank.bank} ****${bank.last4}` : 'the bank'} on ${dmy(run.runDate)}${needsCfo ? ', once the CFO has also released it' : ''}.` +
        (hasBlockers ? ' Everything flagged above goes with it.' : ''),
      ifRejected: `${run.preparedBy.name} edits the proposal and sends it again.` +
        (msmeOverdue.length ? ` The overdue MSME ${msmeOverdue.length === 1 ? 'invoice waits' : 'invoices wait'} with it.` : '') +
        ` If it is not back by ${dmy(run.runDate, false)}, the run slips a day.`
    },
    detail: {
      runId: run.runId,
      runDate: run.runDate,
      bankAccount: bank || null,
      available,
      lines: lines.map((l) => ({
        docNo: l.docNo,
        vendorId: l.vendorId,
        vendorName: l.vendorName,
        vendorReference: l.vendorReference,
        dueDate: l.dueDate,
        net: l.net,
        overdue: l.overdue,
        msme: l.msme,
        msmeBreached: l.msmeBreached,
        daysSincePosting: l.daysSincePosting,
        duplicate: duplicates.some((p) => p.second === l.docNo),
        bankChanged: vendorById.get(l.vendorId)?.bankChangedRecently || false
      }))
    }
  };
}

// --- Putting the queue together ---------------------------------------------------------------

export function buildApprovals({ journalEntries, payables, runs, vendors, bankAccounts, meta, closeTasks, customers, decisions, me, today }) {
  const glById = new Map(meta.glAccounts.map((g) => [g.gl, g.name]));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const apByDoc = new Map(payables.openItems.map((i) => [i.docNo, i]));
  const ctx = {
    glName: (gl) => glById.get(gl) || gl,
    fiscal: meta.fiscal,
    closeTasks,
    customers,
    vendorById,
    duplicates: payables.duplicates,
    apByDoc,
    bankAccounts,
    openPayables: payables.openItems,
    today
  };

  // A blocked invoice that has since been released (here, or in SAP) is no longer blocked,
  // but one released here still belongs in the list so the decision can be seen.
  const blocked = payables.openItems.filter((i) => i.blockReason);

  const documents = [
    ...journalEntries.map((je) => journalEntry(je, ctx)),
    ...blocked.map((i) => blockedInvoice(i, ctx)),
    ...runs.map((r) => paymentRun(r, ctx))
  ].map((d) => {
    const c = chain({ kind: d.kind, id: d.id, preparedBy: d.preparedBy, preparedAt: d.preparedAt, needsCfo: d.needsCfo, me, cfo: meta.people.cfo, decisions });
    const tone = worstTone(d.checks);
    const negatives = d.checks.filter((x) => x.tone === 'neg');
    const warnings = d.checks.filter((x) => x.tone === 'warn');
    return {
      ...d,
      ...c,
      hoursWaiting: hoursSince(d.preparedAt),
      tone,
      advice: negatives.length
        ? `${plural(negatives.length, 'thing')} to settle before signing: ${negatives[0].text}`
        : warnings.length
          ? `Fine to sign, with ${plural(warnings.length, 'point')} to note: ${warnings[0].text}`
          : 'Every check passed. Nothing here needs a second look.'
    };
  });

  const order = { 'with-you': 0, 'with-cfo': 1, approved: 2, rejected: 3 };
  documents.sort(
    (a, b) => order[a.status] - order[b.status] || TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.hoursWaiting - a.hoursWaiting
  );
  return documents;
}
