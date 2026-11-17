// The assistant without a model: plain rules over the same read handlers.
//
// Used when no API key is set, and as the fallback when the model is out of quota or
// unreachable. It recognises a dozen kinds of question by their words and answers each from
// the handler the model would have called, so a figure is the same either way. It cannot
// hold a conversation and it cannot act; it says so when asked to.

import { READ_HANDLERS, companyCodeFrom } from './tools.js';
import { money } from '../domain/format.js';

const has = (q, ...words) => words.some((w) => q.includes(w));

function list(items, max = 8) {
  if (!items.length) return '';
  const shown = items.slice(0, max).map((i) => `- ${i}`);
  if (items.length > max) shown.push(`- and ${items.length - max} more`);
  return shown.join('\n');
}

function nameMatch(q, rows) {
  return rows.find((r) => {
    const first = r.name.toLowerCase().split(/[\s.]+/).filter((w) => w.length > 3)[0];
    return q.includes(r.name.toLowerCase()) || (first && q.includes(first));
  });
}

export function readIntent(question, data, filter = {}) {
  const q = String(question || '').toLowerCase();
  const fromQuestion = companyCodeFrom(q, data);
  const unit = fromQuestion || (filter.companyCode && filter.companyCode !== 'all' ? filter.companyCode : null);
  const args = { company_code: unit };

  if (has(q, 'remind', 'send ', 'email', 'mail ', 'export', 'download', 'flag')) {
    return {
      text:
        'Without a model key I can only answer questions, not act. Reminders are on the **Receivables** screen ' +
        '(open a customer, then *Send reminder*), and every list there can be exported. Add a GROQ_API_KEY or ' +
        'GEMINI_API_KEY to the backend to let me do it from here.'
    };
  }
  if (has(q, 'approve this', 'post it', 'release it', 'reject')) {
    return { text: 'Approving, rejecting and releasing need your own signature on the **Approvals** screen. I cannot do it for you.' };
  }

  // A document number or reference.
  const number = /\b(1000004\d{2}|51\d{8}|9\d{8}|f110-\d{4}-\d{4}|[a-z]{2,3}[/-]\d{3,4}[/-]\d{2}-\d{2})\b/i.exec(question || '');
  if (number) {
    const r = READ_HANDLERS.get_document({ number: number[1] }, data);
    if (!r.found) return { text: r.message };
    if (r.type === 'approval') {
      return {
        text: [
          `**${r.kind} ${r.number}**, ${r.title}: ${r.amount}, ${r.status.toLowerCase()}. Prepared by ${r.prepared_by}, waiting ${r.waiting_hours} h.`,
          r.problems.length ? `\n**Settle first:**\n${list(r.problems)}` : '\nNo checks failed.',
          r.points_to_note.length ? `\n**To note:**\n${list(r.points_to_note)}` : '',
          `\n*If approved:* ${r.if_approved}\n\n*If sent back:* ${r.if_sent_back}`
        ].join('\n')
      };
    }
    return {
      text: Object.entries(r)
        .filter(([k, v]) => k !== 'found' && v !== undefined && v !== null && v !== false)
        .map(([k, v]) => `- **${k.replace(/_/g, ' ')}:** ${v}`)
        .join('\n')
    };
  }

  if (has(q, 'msme', '45 day', '45-day', 'micro', 'small enterprise')) {
    const r = READ_HANDLERS.get_payables_due({ ...args, within_days: 14, msme_only: true }, data);
    return {
      text: r.msme_past_45_days.length
        ? `**${r.msme_past_45_days.length} MSME invoice${r.msme_past_45_days.length === 1 ? '' : 's'} past 45 days** in ${r.unit}:\n${list(r.msme_past_45_days)}\n\nInterest under the MSMED Act runs on these until they are paid.`
        : `No MSME invoice in ${r.unit} is past 45 days.`
    };
  }

  if (has(q, 'cash', 'bank', 'liquidity', 'forecast', 'headroom', 'run out')) {
    const r = READ_HANDLERS.get_cash_forecast(args, data);
    const rows = r.weeks.map((w) => `| ${w.week} | ${w.money_in} | ${w.money_out} | ${w.closing_balance} | ${w.headroom_incl_cash_credit} |`);
    return {
      text: [
        `**Cash, ${r.unit}.** In the bank today: ${r.bank_balance_today}${r.cash_credit_limits !== '₹0' ? `, with ${r.cash_credit_limits} of cash credit limits` : ''}.`,
        r.units_going_short.length ? `\n**Going short:** ${r.units_going_short.join('; ')}.` : `\n${unit ? 'Stays' : 'Every unit stays'} within ${unit ? 'its' : 'its'} cash credit limit for the next eight weeks.`,
        ...data.approvals
          .filter((a) => a.kind === 'RUN' && a.status !== 'rejected' && (!unit || a.companyCode === unit) && a.amount > a.detail.available)
          .map((a) => `\n**But tomorrow's run ${a.detail.runId} needs ${money(a.amount)} against ${money(a.detail.available)} available today**, before any of this week's collections arrive.`),
        '\n| Week | In | Out | Closing | Headroom |\n|---|---|---|---|---|',
        ...rows,
        `\nBlocked invoices not counted: ${r.blocked_invoices_not_counted}.`
      ].join('\n')
    };
  }

  if (has(q, 'approv', 'waiting for me', 'sign', 'pending', 'parked', 'payment run', 'blocked invoice', 'journal')) {
    const kind = has(q, 'journal', 'parked', 'je ') ? 'JE' : has(q, 'run') ? 'RUN' : has(q, 'invoice') ? 'INV' : null;
    const r = READ_HANDLERS.list_pending_approvals({ ...args, kind }, data);
    if (!r.count) return { text: `Nothing is waiting for you in ${r.unit}.` };
    const onlyProblems = has(q, 'problem', 'issue', 'wrong', 'risk');
    const docs = onlyProblems ? r.documents.filter((d) => d.problems.length) : r.documents;
    return {
      text: [
        `**${r.count} waiting for you** in ${r.unit}, ${r.total_value} in total; ${r.with_problems} with something to settle first.`,
        '',
        ...docs.map((d) => `- **${d.kind} ${d.number}**, ${d.title}, ${d.amount}${d.problems.length ? `: ${d.problems[0]}` : ''}`),
        r.waiting_for_cfo.length ? `\nSigned by you, waiting for the CFO: ${r.waiting_for_cfo.join('; ')}.` : ''
      ].join('\n')
    };
  }

  if (has(q, 'budget', 'cost cent', 'overrun', 'overspend', 'variance', 'spend')) {
    const r = READ_HANDLERS.get_budget_variance(args, data);
    const over = r.cost_centres.filter((c) => c.status === 'over' || c.status === 'watch');
    return {
      text: [
        `**Spend to ${r.through}, ${r.unit}:** ${r.actual_to_date} against a plan of ${r.plan_to_date}.`,
        over.length ? `\nRunning over:\n${list(over.map((c) => `${c.name}: ${c.variance}, heading for ${c.full_year_estimate} against ${c.annual_budget} (${c.owner})`))}` : '\nNo cost centre is running over plan.'
      ].join('\n')
    };
  }

  if (has(q, 'close', 'month end', 'month-end', 'period end')) {
    const r = READ_HANDLERS.get_close_status(args, data);
    return {
      text: [
        `**${r.period} close, ${r.unit}:** working day ${r.working_day_today}, ${r.done} tasks done.`,
        r.waiting_on_your_approval.length ? `\n**Waiting on your approval:**\n${list(r.waiting_on_your_approval)}` : '',
        r.late.length ? `\n**Late:**\n${list(r.late)}` : '\nNothing is late.'
      ].join('\n')
    };
  }

  const vendor = nameMatch(q, data.payables.vendors);
  if (vendor) {
    const r = READ_HANDLERS.get_vendor({ vendor: vendor.id }, data);
    return {
      text: [
        `**${r.name}** (${r.number})${r.msme !== 'no' ? `, MSME ${r.msme}` : ''}: ${r.open} open, ${r.overdue} overdue, ${r.blocked} blocked, ${r.in_payment_run} in a payment run.`,
        r.bank_changed !== 'no recent change' ? `\n**Bank details changed ${r.bank_changed}.**` : '',
        r.invoices.length ? `\n${list(r.invoices)}` : ''
      ].join('\n')
    };
  }

  const customer = nameMatch(q, data.receivables.customers);
  if (customer) {
    const r = READ_HANDLERS.get_customer({ customer: customer.id }, data);
    return {
      text: [
        `**${r.name}** (${r.number}), standing: **${r.standing}**. Owes ${r.owes}, ${r.overdue} overdue; ${r.credit_used_percent}% of a ${r.credit_limit} limit.`,
        r.why.length ? `\n${list(r.why)}` : '',
        `\nUsually pays ${r.usually_pays_days_late ?? '?'} days late (${r.trend}); DSO ${r.dso_days ?? '?'} days. Last reminder: ${r.last_reminder}.`,
        r.promises.length ? `\nPromises: ${r.promises.join('; ')}.` : ''
      ].join('\n')
    };
  }

  if (has(q, 'payable', 'pay this week', 'due this week', 'we owe', 'suppliers', 'vendors', 'discount')) {
    const r = READ_HANDLERS.get_payables_due(args, data);
    return {
      text: [
        `**Payables, ${r.unit}:** ${r.due_total} due in the next ${r.due_within_days} days, ${r.overdue_total} already overdue, ${r.blocked} blocked.`,
        r.overdue.length ? `\n**Overdue:**\n${list(r.overdue)}` : '',
        r.discounts_available.length ? `\n**Discounts available:**\n${list(r.discounts_available)}` : ''
      ].join('\n')
    };
  }

  if (has(q, 'overdue', 'receivable', 'collect', 'dso', 'ageing', 'aging', 'owes us', 'owe us', 'customers', 'debtors')) {
    const r = READ_HANDLERS.list_overdue_receivables(args, data);
    return {
      text: [
        `**Receivables, ${r.unit}:** ${r.total_receivables} outstanding, ${r.total_overdue} overdue. DSO ${r.dso_days} days.`,
        '',
        list(r.customers.map((c) => `${c.customer}: ${c.overdue} overdue, oldest ${c.oldest_days} days (${c.standing.toLowerCase()})`), 10)
      ].join('\n')
    };
  }

  if (has(q, 'problem', 'issue', 'risk', 'wrong', 'fraud', 'duplicate', 'anomal', 'check')) {
    const r = READ_HANDLERS.list_problems(args, data);
    return {
      text: r.count
        ? `**${r.count} problems found** in ${r.unit}:\n${list(r.problems.map((p) => `${p.title} (${p.owner}: ${p.suggested_fix.toLowerCase()})`), 12)}`
        : `No open problems in ${r.unit}.`
    };
  }

  return {
    text:
      'I can answer from the dashboard’s data: what is **waiting for your approval**, a **document number**, a **customer** or **vendor** by name, ' +
      '**overdue receivables** and DSO, **payables due** and MSME invoices, the **cash forecast**, **budget variance**, the **month-end close**, and **problems found**. Try one of those.'
  };
}
