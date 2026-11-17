// What the assistant is allowed to look at, and what it is allowed to do.
//
//   READ_TOOLS    answer questions. They run the moment the model asks for them.
//   ACTION_TOOLS  change something or send something. They NEVER run when the model asks.
//                 The request is turned into a sentence, shown to the person, and only
//                 carried out after they press Confirm.
//
// The model never writes a query. It picks a name off this list and supplies arguments, and
// the handler does the looking - against the same assessed data the screens show, so the
// assistant cannot quietly disagree with the page behind it.

import { money, dmy, plural, sum } from '../domain/format.js';
import { BUCKETS } from '../domain/receivables.js';
import { sendCustomerReminder, flagReference } from '../routes/actions.js';

export { dmy };

function loosely(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// "Pune", "1000", "pune unit" all mean company code 1000.
export function companyCodeFrom(value, data) {
  if (!value) return null;
  const v = loosely(value);
  if (!v || v === 'all' || v === 'allunits' || v === 'allcompanycodes') return null;
  const found = data.companyCodes.find((c) => v.includes(c.code) || v.includes(loosely(c.name)));
  return found ? found.code : null;
}

function unitName(code, data) {
  if (!code) return 'all units';
  const c = data.companyCodes.find((x) => x.code === code);
  return c ? `${c.name} (${c.code})` : code;
}

function inUnit(row, code) {
  return !code || row.companyCode === code;
}

function findCustomer(name, data) {
  const n = loosely(name);
  if (!n) return null;
  const list = data.receivables.customers;
  return list.find((c) => loosely(c.id) === n) || list.find((c) => loosely(c.name).includes(n)) || list.find((c) => n.includes(loosely(c.name).slice(0, 8)));
}

function findVendor(name, data) {
  const n = loosely(name);
  if (!n) return null;
  const list = data.payables.vendors;
  return list.find((v) => loosely(v.id) === n) || list.find((v) => loosely(v.name).includes(n)) || list.find((v) => n.includes(loosely(v.name).slice(0, 8)));
}

// --- Declarations the model sees -----------------------------------------------------------

const unitParam = { type: 'STRING', description: 'Company code or unit name: 1000 Pune, 2000 Mumbai or 3000 Nagpur. Omit for all units.' };

export const READ_TOOLS = [
  {
    name: 'get_document',
    description: 'Look up one document by number: a parked journal entry, a blocked or open supplier invoice, a payment run, or a customer invoice. Use whenever a document number or invoice reference is mentioned.',
    parameters: { type: 'OBJECT', properties: { number: { type: 'STRING', description: 'Document number or reference, e.g. 100000412, F110-3000-1011, BB/2231/26-27.' } }, required: ['number'] }
  },
  {
    name: 'list_pending_approvals',
    description: 'What is waiting for a finance signature: parked journal entries (JE), blocked supplier invoices (INV) and payment runs (RUN), with the checks that failed on each.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', description: 'JE, INV or RUN. Omit for all kinds.' },
        company_code: unitParam,
        older_than_hours: { type: 'NUMBER', description: 'Only items waiting longer than this.' }
      }
    }
  },
  {
    name: 'get_customer',
    description: 'One customer: what they owe, overdue by age bucket, credit limit use, how late they usually pay, promises to pay, reminders sent, and why they are flagged.',
    parameters: { type: 'OBJECT', properties: { customer: { type: 'STRING', description: 'Customer name or number.' } }, required: ['customer'] }
  },
  {
    name: 'list_overdue_receivables',
    description: 'Customers with overdue invoices, worst first, with totals by age bucket and DSO. Use for questions about collections, who owes us, ageing or DSO.',
    parameters: { type: 'OBJECT', properties: { company_code: unitParam, min_days_overdue: { type: 'NUMBER', description: 'Only items overdue by more than this many days.' } } }
  },
  {
    name: 'get_vendor',
    description: 'One supplier: open and overdue invoices, blocked amount, MSME status, recent bank detail changes, what is in a payment run.',
    parameters: { type: 'OBJECT', properties: { vendor: { type: 'STRING', description: 'Vendor name or number.' } }, required: ['vendor'] }
  },
  {
    name: 'get_payables_due',
    description: 'Supplier invoices falling due, overdue ones, MSME invoices near or past the 45-day limit, and early-payment discounts available.',
    parameters: {
      type: 'OBJECT',
      properties: {
        company_code: unitParam,
        within_days: { type: 'NUMBER', description: 'Due within this many days. Default 7.' },
        msme_only: { type: 'BOOLEAN', description: 'Only MSME vendors.' }
      }
    }
  },
  {
    name: 'get_cash_forecast',
    description: 'Bank balances today and the eight-week cash forecast: money in, money out, closing balance per week and the tightest week.',
    parameters: { type: 'OBJECT', properties: { company_code: unitParam } }
  },
  {
    name: 'get_budget_variance',
    description: 'Cost centre spend against plan, year to date, with the full-year estimate at the current run rate.',
    parameters: { type: 'OBJECT', properties: { company_code: unitParam, cost_centre: { type: 'STRING', description: 'Cost centre id or name, e.g. 2000-LOG or logistics.' } } }
  },
  {
    name: 'get_close_status',
    description: 'Month-end close progress: tasks done, late, blocked, and which are waiting on your approval.',
    parameters: { type: 'OBJECT', properties: { company_code: unitParam } }
  },
  {
    name: 'list_problems',
    description: 'Problems the dashboard found: duplicate invoices, bank changes before payment, MSME invoices past 45 days, customers over limit, unfunded runs, discounts expiring, unusual journals, old GR/IR, budget overruns, stuck close tasks.',
    parameters: { type: 'OBJECT', properties: { company_code: unitParam, include_fixed: { type: 'BOOLEAN', description: 'Include ones already handled.' } } }
  }
];

export const ACTION_TOOLS = [
  {
    name: 'send_payment_reminder',
    description: 'Send a customer a payment reminder listing their overdue invoices. Level 1 friendly, 2 firm, 3 final. Omit level to use the one their oldest overdue item has earned.',
    parameters: {
      type: 'OBJECT',
      properties: { customer: { type: 'STRING', description: 'Customer name or number.' }, level: { type: 'NUMBER', description: '1, 2 or 3.' } },
      required: ['customer']
    }
  },
  {
    name: 'flag_for_review',
    description: 'Flag a document, customer or vendor for the user to follow up later.',
    parameters: {
      type: 'OBJECT',
      properties: { reference: { type: 'STRING', description: 'What to flag: a document number, customer or vendor.' }, reason: { type: 'STRING', description: 'Why, in a few words.' } },
      required: ['reference']
    }
  },
  {
    name: 'export_report',
    description: 'Export a list as a CSV file to download: overdue_receivables, payables_due, approvals, budget or problems.',
    parameters: {
      type: 'OBJECT',
      properties: { report: { type: 'STRING', description: 'overdue_receivables, payables_due, approvals, budget or problems.' }, company_code: unitParam },
      required: ['report']
    }
  }
];

export function isAction(name) {
  return ACTION_TOOLS.some((t) => t.name === name);
}

// --- Read handlers ---------------------------------------------------------------------------

function approvalSummary(d) {
  return {
    kind: d.kindLabel,
    number: d.id,
    unit: d.companyCode,
    title: d.title,
    amount: money(d.amount),
    status: d.statusLabel,
    prepared_by: d.preparedBy.name,
    waiting_hours: d.hoursWaiting,
    needs_cfo_too: d.needsCfo,
    problems: d.checks.filter((c) => c.tone === 'neg').map((c) => c.text),
    points_to_note: d.checks.filter((c) => c.tone === 'warn').map((c) => c.text)
  };
}

export const READ_HANDLERS = {
  get_document({ number }, data) {
    const n = loosely(number);
    const approval = data.approvals.find((d) => loosely(d.id) === n || loosely(d.detail?.runId) === n);
    if (approval) {
      return {
        found: true,
        type: 'approval',
        ...approvalSummary(approval),
        all_checks: approval.checks.map((c) => c.text),
        if_approved: approval.consequence.ifApproved,
        if_sent_back: approval.consequence.ifRejected,
        lines: approval.kind === 'JE' ? approval.detail.lines.map((l) => `${l.gl} ${l.glName}: ${l.debit ? `Dr ${money(l.debit)}` : `Cr ${money(l.credit)}`}`) : undefined
      };
    }
    const ap = data.payables.openItems.find((i) => loosely(i.docNo) === n || loosely(i.vendorReference) === n);
    if (ap) {
      return {
        found: true,
        type: 'supplier invoice',
        number: ap.docNo,
        reference: ap.vendorReference,
        vendor: ap.vendorName,
        unit: ap.companyCode,
        amount: money(ap.gross),
        status: ap.status === 'blocked' ? `blocked: ${ap.blockReason}` : 'open',
        due: dmy(ap.dueDate),
        overdue: ap.overdue,
        in_payment_run: ap.inRun,
        msme: ap.msme ? `${ap.daysSincePosting} days since acceptance, limit ${dmy(ap.msmeDeadline)}` : 'not MSME',
        possible_duplicate_of: ap.duplicateOf
      };
    }
    const ar = data.receivables.openItems.find((i) => loosely(i.docNo) === n || loosely(i.reference) === n);
    if (ar) {
      return {
        found: true,
        type: 'customer invoice',
        number: ar.docNo,
        reference: ar.reference,
        customer: ar.customerName,
        unit: ar.companyCode,
        amount_open: money(ar.openAmount),
        invoice_date: dmy(ar.invoiceDate),
        due: dmy(ar.dueDate),
        days_overdue: Math.max(0, ar.daysOverdue),
        disputed: ar.disputed ? ar.disputeNote : false
      };
    }
    return { found: false, message: `Nothing numbered ${number} is visible in this dashboard.` };
  },

  list_pending_approvals({ kind, company_code, older_than_hours }, data) {
    const code = companyCodeFrom(company_code, data);
    const k = String(kind || '').toUpperCase();
    const rows = data.approvals
      .filter((d) => d.status === 'with-you')
      .filter((d) => !k || d.kind === k)
      .filter((d) => inUnit(d, code))
      .filter((d) => !older_than_hours || d.hoursWaiting > Number(older_than_hours));
    return {
      unit: unitName(code, data),
      count: rows.length,
      total_value: money(sum(rows, 'amount')),
      with_problems: rows.filter((d) => d.tone === 'neg').length,
      documents: rows.map(approvalSummary),
      waiting_for_cfo: data.approvals.filter((d) => d.status === 'with-cfo' && inUnit(d, code)).map((d) => `${d.kindLabel} ${d.id}, ${money(d.amount)}`)
    };
  },

  get_customer({ customer }, data) {
    const c = findCustomer(customer, data);
    if (!c) return { found: false, message: `No customer matching "${customer}" is visible.` };
    return {
      found: true,
      number: c.id,
      name: c.name,
      unit: c.companyCode,
      standing: c.bandLabel,
      why: c.reasons,
      owes: money(c.exposure),
      overdue: money(c.overdue),
      by_age: Object.fromEntries(BUCKETS.map((b) => [b.label, money(c.buckets[b.key])])),
      credit_limit: money(c.creditLimit),
      credit_used_percent: c.creditUsedPercent,
      payment_terms_days: c.paymentTermsDays,
      usually_pays_days_late: c.averageDaysLate,
      trend: c.trend,
      dso_days: c.dso,
      disputed: money(c.disputed),
      promises: c.promises.map((p) => `${money(p.amount)} by ${dmy(p.promisedFor)}: ${p.status}`),
      last_reminder: c.lastReminder ? `level ${c.lastReminder.level}, ${dmy(c.lastReminder.sentAt.slice(0, 10))}` : 'none',
      reminder_level_due: c.reminderLevel,
      contact: c.contact,
      account_manager: c.accountManager
    };
  },

  list_overdue_receivables({ company_code, min_days_overdue }, data) {
    const code = companyCodeFrom(company_code, data);
    const min = Number(min_days_overdue) || 0;
    const items = data.receivables.openItems.filter((i) => inUnit(i, code) && i.daysOverdue > min);
    const all = data.receivables.openItems.filter((i) => inUnit(i, code));
    const customers = data.receivables.customers.filter((c) => inUnit(c, code));
    const byCustomer = customers
      .map((c) => ({ c, mine: items.filter((i) => i.customerId === c.id) }))
      .filter((x) => x.mine.length)
      .map(({ c, mine }) => ({ customer: c.name, overdue: money(sum(mine, 'openAmount')), oldest_days: Math.max(...mine.map((i) => i.daysOverdue)), standing: c.bandLabel, why: c.reasons[0] }))
      .sort((a, b) => b.oldest_days - a.oldest_days);
    const exposure = sum(all, 'openAmount');
    const billed90 = sum(customers, (c) => (c.dso ? c.exposure / c.dso : 0)) * 90;
    return {
      unit: unitName(code, data),
      total_receivables: money(exposure),
      total_overdue: money(sum(items, 'openAmount')),
      dso_days: billed90 ? Math.round(exposure / (billed90 / 90)) : null,
      by_age: Object.fromEntries(BUCKETS.map((b) => [b.label, money(sum(all.filter((i) => i.bucket === b.key), 'openAmount'))])),
      customers: byCustomer
    };
  },

  get_vendor({ vendor }, data) {
    const v = findVendor(vendor, data);
    if (!v) return { found: false, message: `No vendor matching "${vendor}" is visible.` };
    const items = data.payables.openItems.filter((i) => i.vendorId === v.id);
    return {
      found: true,
      number: v.id,
      name: v.name,
      msme: v.msme ? v.msmeCategory : 'no',
      open: money(v.open),
      overdue: money(v.overdue),
      blocked: money(v.blocked),
      in_payment_run: money(v.inRun),
      bank_changed: v.bankChangedRecently ? `${v.bankChangedDaysAgo} days ago, by ${v.bankChangedBy}` : 'no recent change',
      we_pay_days_late_on_average: v.ourAverageDaysLate,
      invoices: items.map((i) => `${i.vendorReference}: ${money(i.gross)}, due ${dmy(i.dueDate)}${i.status === 'blocked' ? `, blocked (${i.blockReason})` : ''}${i.inRun ? `, in ${i.inRun}` : ''}${i.duplicateOf ? ', possible duplicate' : ''}`)
    };
  },

  get_payables_due({ company_code, within_days, msme_only }, data) {
    const code = companyCodeFrom(company_code, data);
    const days = Number(within_days) || 7;
    const open = data.payables.openItems.filter((i) => inUnit(i, code) && i.status === 'open' && (!msme_only || i.msme));
    const due = open.filter((i) => !i.overdue && i.dueIn <= days);
    const overdue = open.filter((i) => i.overdue);
    return {
      unit: unitName(code, data),
      due_within_days: days,
      due_total: money(sum(due, 'net')),
      overdue_total: money(sum(overdue, 'net')),
      overdue: overdue.map((i) => `${i.vendorName} ${i.vendorReference}: ${money(i.net)}, due ${dmy(i.dueDate)}${i.inRun ? `, in ${i.inRun}` : ', in no run'}`),
      due_soon: due.map((i) => `${i.vendorName} ${i.vendorReference}: ${money(i.net)}, due ${dmy(i.dueDate)}`),
      msme_past_45_days: data.payables.openItems.filter((i) => inUnit(i, code) && i.msmeBreached).map((i) => `${i.vendorName} ${i.vendorReference}: ${money(i.gross)}, ${i.daysSincePosting} days${i.inRun ? `, in ${i.inRun}` : ', in no run'}`),
      discounts_available: open.filter((i) => i.discount).map((i) => `${i.vendorName}: ${money(i.discount.amount)} if paid by ${dmy(i.discount.by)}`),
      blocked: money(sum(data.payables.openItems.filter((i) => inUnit(i, code) && i.status === 'blocked'), 'gross'))
    };
  },

  get_cash_forecast({ company_code }, data) {
    const code = companyCodeFrom(company_code, data);
    const codes = code ? [code] : data.companyCodes.map((c) => c.code);
    const fs = codes.map((c) => data.cash[c]);
    const weeks = fs[0].weeks.map((w, i) => {
      const inflow = sum(fs, (f) => f.weeks[i].inflow);
      const outflow = sum(fs, (f) => f.weeks[i].outflow);
      const closing = sum(fs, (f) => f.weeks[i].closing);
      const headroom = sum(fs, (f) => f.weeks[i].headroom);
      return { week: w.label, money_in: money(inflow), money_out: money(outflow), closing_balance: money(closing), headroom_incl_cash_credit: money(headroom) };
    });
    return {
      unit: unitName(code, data),
      bank_balance_today: money(sum(fs, 'opening')),
      cash_credit_limits: money(sum(fs, 'facility')),
      weeks,
      units_going_short: fs.filter((f) => f.firstShortWeek).map((f) => `${unitName(f.companyCode, data)} from ${f.firstShortWeek}`),
      blocked_invoices_not_counted: money(sum(fs, 'blockedValue')),
      method: 'Customer invoices on due date plus their usual delay, weighted by likelihood; supplier invoices on due date; payment runs on run date; salaries, GST, TDS, PF and loan instalments on their usual days.'
    };
  },

  get_budget_variance({ company_code, cost_centre }, data) {
    const code = companyCodeFrom(company_code, data);
    const n = loosely(cost_centre);
    let rows = data.budgets.filter((b) => inUnit(b, code));
    if (n) rows = rows.filter((b) => loosely(b.id).includes(n) || loosely(b.name).includes(n));
    return {
      unit: unitName(code, data),
      through: data.fiscal.closingPeriodLabel,
      plan_to_date: money(sum(rows, 'ytdPlan')),
      actual_to_date: money(sum(rows, 'ytdActual')),
      cost_centres: rows.map((b) => ({
        id: b.id,
        name: `${b.name}, ${unitName(b.companyCode, data)}`,
        owner: b.owner,
        variance: `${b.variancePercent > 0 ? '+' : ''}${b.variancePercent}% (${money(b.variance)})`,
        full_year_estimate: money(b.forecast),
        annual_budget: money(b.annualPlan),
        status: b.status
      }))
    };
  },

  get_close_status({ company_code }, data) {
    const code = companyCodeFrom(company_code, data);
    const tasks = data.close.tasks.filter((t) => inUnit(t, code));
    return {
      period: data.fiscal.closingPeriodLabel,
      unit: unitName(code, data),
      working_day_today: data.close.workingDay,
      done: `${tasks.filter((t) => t.status === 'done').length} of ${tasks.length}`,
      late: tasks.filter((t) => t.late).map((t) => `${t.title} (unit ${t.companyCode}, WD${t.workingDay}, ${t.status}, ${t.owner})${t.note ? `: ${t.note}` : ''}`),
      waiting_on_your_approval: tasks.filter((t) => t.waitingOnYou).map((t) => `${t.title} (unit ${t.companyCode}) needs ${t.waitingOn.filter((w) => w.withYou).map((w) => w.id).join(', ')}`)
    };
  },

  list_problems({ company_code, include_fixed }, data) {
    const code = companyCodeFrom(company_code, data);
    const rows = data.problems.filter((p) => inUnit(p, code) && (include_fixed || !p.fixed));
    return {
      unit: unitName(code, data),
      count: rows.length,
      problems: rows.map((p) => ({ type: p.typeLabel, severity: p.severity, title: p.title, owner: p.owner.name, suggested_fix: p.fix.label, handled: p.fixed ? `by ${p.fixed.fixedBy}` : false }))
    };
  }
};

// --- Describing an action before it happens --------------------------------------------------

export function describeAction(name, args, data) {
  if (name === 'send_payment_reminder') {
    const c = findCustomer(args.customer, data);
    if (!c) return { summary: `Send a payment reminder to "${args.customer}"`, detail: ['No customer by that name is visible, so this will fail.'], confirmLabel: 'Try anyway' };
    const level = Math.min(3, Math.max(1, Number(args.level) || c.reminderLevel || 1));
    return {
      summary: `Send ${c.name} a level ${level} payment reminder`,
      detail: [`Lists ${plural(c.overdueCount, 'overdue invoice')} totalling ${money(c.overdue)}`, `To ${c.contact}, signed by ${data.people.ar.name}`],
      confirmLabel: 'Send it'
    };
  }
  if (name === 'flag_for_review') {
    return { summary: `Flag ${args.reference} for your follow-up`, detail: [args.reason].filter(Boolean), confirmLabel: 'Flag it' };
  }
  if (name === 'export_report') {
    return { summary: `Export ${String(args.report || '').replace(/_/g, ' ')} as a CSV file`, detail: ['The file downloads to this computer. Nothing is sent anywhere.'], confirmLabel: 'Export' };
  }
  return { summary: `Run ${name}`, detail: [], confirmLabel: 'Confirm' };
}

// --- Carrying an action out, after Confirm -----------------------------------------------------

function csv(rows) {
  if (!rows.length) return '';
  const head = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head.join(','), ...rows.map((r) => head.map((h) => cell(r[h])).join(','))].join('\n');
}

export const ACTION_HANDLERS = {
  async send_payment_reminder(args, data) {
    const c = findCustomer(args.customer, data);
    if (!c) return { done: false, message: `No customer matching "${args.customer}".` };
    const result = await sendCustomerReminder({ data, customerId: c.id, level: args.level });
    return { done: true, message: `Level ${result.level} reminder recorded for ${c.name}. Mail: ${result.mail.status}.`, mail_status: result.mail.status };
  },

  async flag_for_review(args, data) {
    flagReference({ me: data.me, reference: String(args.reference), reason: args.reason });
    return { done: true, message: `Flagged ${args.reference}.` };
  },

  async export_report(args, data) {
    const code = companyCodeFrom(args.company_code, data);
    const report = String(args.report || '').toLowerCase();
    let rows = [];
    if (report.includes('receiv')) {
      rows = data.receivables.openItems.filter((i) => inUnit(i, code) && i.daysOverdue > 0).map((i) => ({
        customer: i.customerName, invoice: i.docNo, reference: i.reference, unit: i.companyCode, invoice_date: i.invoiceDate, due_date: i.dueDate, days_overdue: i.daysOverdue, open_amount: i.openAmount, disputed: i.disputed ? 'yes' : ''
      }));
    } else if (report.includes('payab')) {
      rows = data.payables.openItems.filter((i) => inUnit(i, code)).map((i) => ({
        vendor: i.vendorName, document: i.docNo, reference: i.vendorReference, unit: i.companyCode, due_date: i.dueDate, gross: i.gross, net: i.net, status: i.status, block_reason: i.blockReason || '', msme: i.msme ? i.msmeCategory : '', msme_days: i.msme ? i.daysSincePosting : '', payment_run: i.inRun || ''
      }));
    } else if (report.includes('approv')) {
      rows = data.approvals.filter((d) => inUnit(d, code)).map((d) => ({
        kind: d.kindLabel, number: d.id, unit: d.companyCode, title: d.title, amount: d.amount, status: d.statusLabel, prepared_by: d.preparedBy.name, hours_waiting: d.hoursWaiting, problems: d.checks.filter((c) => c.tone === 'neg').map((c) => c.text).join(' | ')
      }));
    } else if (report.includes('budget')) {
      rows = data.budgets.filter((b) => inUnit(b, code)).map((b) => ({
        cost_centre: b.id, name: b.name, unit: b.companyCode, owner: b.owner, plan_to_date: b.ytdPlan, actual_to_date: b.ytdActual, variance: b.variance, variance_percent: b.variancePercent, annual_plan: b.annualPlan, full_year_estimate: b.forecast
      }));
    } else if (report.includes('problem')) {
      rows = data.problems.filter((p) => inUnit(p, code)).map((p) => ({
        type: p.typeLabel, severity: p.severity, unit: p.companyCode, title: p.title, owner: p.owner.name, fix: p.fix.label, handled: p.fixed ? p.fixed.fixedBy : ''
      }));
    } else {
      return { done: false, message: `There is no report called ${args.report}.` };
    }
    const filename = `${report.replace(/[^a-z_]/g, '') || 'report'}-${code || 'all'}-${data.asOf}.csv`;
    return { done: true, message: `Exported ${plural(rows.length, 'row')} as ${filename}.`, filename, content: csv(rows) };
  }
};
