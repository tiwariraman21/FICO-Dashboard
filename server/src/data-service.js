// The layer between the routes and the data source.
//
// Routes stay thin. Everything that involves reading from the provider, laying the
// dashboard's own decisions over it and applying the finance rules happens here, in one
// place, so no route has to know how DSO is worked out or which checks a payment run gets.
//
// Filtering by company code is NOT done here. It happens in the browser, because the
// selector at the top changes every number on every screen at once and a round trip per
// change would make it feel slow.

import { getProvider } from './providers/index.js';
import { readOverlay } from './store.js';
import { setAsOf, today as todayIs, isFrozen } from './domain/clock.js';
import { assessReceivables } from './domain/receivables.js';
import { assessPayables } from './domain/payables.js';
import { buildApprovals } from './domain/approvals.js';
import { buildCashForecast } from './domain/cash.js';
import { assessBudgets } from './domain/budgets.js';
import { assessClose, currentWorkingDay } from './domain/close.js';
import { findProblems } from './domain/problems.js';
import { config } from './config.js';

async function loadAll(provider) {
  const methods = [
    'getMeta', 'getCustomers', 'getReceivables', 'getPromises', 'getDunningHistory', 'getVendors', 'getPayables',
    'getPaymentRuns', 'getJournalEntries', 'getBankAccounts', 'getRecurringOutflows', 'getCostCentres', 'getCloseTasks', 'getGrIr'
  ];
  try {
    const results = await Promise.all(methods.map((m) => provider[m]()));
    return Object.fromEntries(methods.map((m, i) => [m.replace(/^get/, '').replace(/^./, (c) => c.toLowerCase()), results[i]]));
  } catch (error) {
    throw new Error(`Could not load data from the ${provider.name} source. ${error.message}`);
  }
}

// The latest decision on a document at the controller's step, if any.
function controllerDecision(decisions, kind, id) {
  return [...decisions].reverse().find((d) => d.kind === kind && d.docId === id && d.level === 'controller') || null;
}

export async function getEverything(user = {}) {
  const raw = await loadAll(getProvider());
  setAsOf(raw.meta.asOf);
  const today = todayIs();
  const overlay = readOverlay();

  const me = { name: user.name || raw.meta.people.you.name, title: raw.meta.people.you.title };

  // An invoice released here is no longer blocked for payment, once every signature it
  // needs is in. Until the CFO has signed too, it stays blocked.
  const payablesRaw = raw.payables.map((i) => {
    if (i.status !== 'blocked') return i;
    const d = controllerDecision(overlay.decisions, 'INV', i.docNo);
    const needsCfo = i.gross > config.limits.invoiceRelease;
    if (d?.decision === 'approve' && !needsCfo) return { ...i, status: 'open', releasedAt: d.decidedAt, releasedBy: d.decidedBy };
    return i;
  });

  // A payment run sent back is no longer going to pay anything.
  const liveRuns = raw.paymentRuns.filter((r) => controllerDecision(overlay.decisions, 'RUN', r.id)?.decision !== 'reject');

  const receivables = assessReceivables({
    customers: raw.customers,
    items: raw.receivables,
    promises: [...raw.promises, ...overlay.promises],
    reminders: [...raw.dunningHistory, ...overlay.reminders],
    today
  });

  const payables = assessPayables({ vendors: raw.vendors, items: payablesRaw, runs: liveRuns, today });

  const approvals = buildApprovals({
    journalEntries: raw.journalEntries,
    payables,
    runs: raw.paymentRuns,
    vendors: payables.vendors,
    bankAccounts: raw.bankAccounts,
    meta: raw.meta,
    closeTasks: raw.closeTasks,
    customers: receivables.customers,
    decisions: overlay.decisions,
    me,
    today
  });

  const close = assessClose({ tasks: raw.closeTasks, updates: overlay.taskUpdates, approvals, today });
  const budgets = assessBudgets({ costCentres: raw.costCentres, fiscal: raw.meta.fiscal });
  const cash = buildCashForecast({
    companyCodes: raw.meta.companyCodes,
    bankAccounts: raw.bankAccounts,
    receivables,
    payables,
    runs: raw.paymentRuns,
    approvals,
    recurring: raw.recurringOutflows,
    today
  });

  const vendorName = new Map(raw.vendors.map((v) => [v.id, v.name]));
  const grir = raw.grIr.map((g) => ({ ...g, vendorName: vendorName.get(g.vendorId) || g.vendorId })).sort((a, b) => b.ageDays - a.ageDays);

  const problems = findProblems({
    receivables,
    payables,
    approvals,
    budgets,
    close,
    grir,
    vendors: payables.vendors,
    meta: raw.meta,
    fixes: overlay.fixes,
    today
  });

  return {
    asOf: today,
    frozen: isFrozen(),
    fiscal: raw.meta.fiscal,
    companyCodes: raw.meta.companyCodes,
    people: raw.meta.people,
    me,
    limits: config.limits,
    approvals,
    receivables,
    payables,
    bankAccounts: raw.bankAccounts,
    cash,
    budgets,
    close: { tasks: close, workingDay: currentWorkingDay(raw.closeTasks, today) },
    grir,
    problems,
    flags: overlay.flags
  };
}
