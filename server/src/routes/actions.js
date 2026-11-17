// Everything a person can DO from the dashboard.
//
// Each action follows the same order: check it is still allowed against fresh data, save
// it, then send the mail. Saving comes before mail so a mail failure can never lose a
// decision. The browser is told what was saved and what the mail did, separately.
//
// The checks are re-run here, server side, every time. A screen that has been open since
// the morning may show a document as waiting when somebody else has since dealt with it.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getEverything } from '../data-service.js';
import { sendTo } from '../mailer.js';
import { stamp } from '../domain/clock.js';
import { money, dmy, plural } from '../domain/format.js';
import { saveDecision, saveFix, saveTaskUpdate, savePromise, saveReminder, saveFlag, saveMailLog, usedPromiseIds } from '../store.js';

export const actionsRouter = Router();

class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function signOff(me) {
  return ['', '--', me.name, me.title, 'InfraBeat Technologies Pvt. Ltd.', '', 'Sent from the InfraBeat finance dashboard.'];
}

const KINDS = { JE: 'JE', INV: 'INV', RUN: 'RUN' };

// --- Approvals ---------------------------------------------------------------------------

async function decide(req, res, decision) {
  const kind = KINDS[String(req.params.kind || '').toUpperCase()];
  if (!kind) throw new Refusal(400, 'Unknown document kind.');
  const note = String(req.body?.note || '').trim().slice(0, 500);
  if (decision === 'reject' && !note) throw new Refusal(400, 'Say why it is going back. The preparer needs to know what to change.');

  const data = await getEverything(req.user);
  const doc = data.approvals.find((d) => d.kind === kind && d.id === req.params.id);
  if (!doc) throw new Refusal(404, `${kind} ${req.params.id} is not in the approval queue.`);
  if (doc.status !== 'with-you') throw new Refusal(409, `${doc.kindLabel} ${doc.id} is no longer waiting for you: ${doc.statusLabel.toLowerCase()}.`);

  const me = data.me;
  const at = stamp();
  const verb = decision === 'approve' ? 'Approved' : 'Sent back';

  // The preparer hears either way.
  const toPreparer = await sendTo({
    toName: doc.preparedBy.name,
    subject: `${verb}: ${doc.kindLabel.toLowerCase()} ${doc.id}, ${doc.title}`,
    lines: [
      `${doc.preparedBy.name.split(' ')[0]},`,
      '',
      decision === 'approve'
        ? `${doc.kindLabel} ${doc.id} (${doc.title}, ${money(doc.amount)}) is approved.` +
          (doc.needsCfo ? ` It now goes to ${data.people.cfo.name} for the second signature.` : '')
        : `${doc.kindLabel} ${doc.id} (${doc.title}, ${money(doc.amount)}) is coming back to you.`,
      ...(note ? ['', `Note: ${note}`] : []),
      ...(decision === 'reject' && doc.checks.some((c) => c.tone === 'neg')
        ? ['', 'What needs settling:', ...doc.checks.filter((c) => c.tone === 'neg').map((c) => `- ${c.text}`)]
        : []),
      ...signOff(me)
    ]
  });

  let toCfo = null;
  if (decision === 'approve' && doc.needsCfo) {
    toCfo = await sendTo({
      toName: data.people.cfo.name,
      subject: `For your signature: ${doc.kindLabel.toLowerCase()} ${doc.id}, ${money(doc.amount)}`,
      lines: [
        `${data.people.cfo.name.replace(/^(Mr|Ms|Mrs|Dr)\.\s*/, '').split(' ')[0]},`,
        '',
        `I have approved ${doc.kindLabel.toLowerCase()} ${doc.id}: ${doc.title}, ${money(doc.amount)}. It needs your signature as well.`,
        '',
        'What I checked:',
        ...doc.checks.map((c) => `- ${c.text}`),
        ...(note ? ['', `My note: ${note}`] : []),
        ...signOff(me)
      ]
    });
  }

  saveDecision({
    kind,
    docId: doc.id,
    level: 'controller',
    decision,
    by: me.name,
    at,
    note,
    value: doc.amount,
    label: `${decision === 'approve' ? 'approved' : 'sent back'} ${doc.kindLabel.toLowerCase()}` + (decision === 'approve' && doc.needsCfo ? ', passed to the CFO' : ''),
    mail: toPreparer
  });
  if (toCfo) saveMailLog({ by: me.name, at, action: 'asked the CFO to sign', reference: doc.id, note: doc.title, mail: toCfo });

  res.json({ saved: true, decision, passedTo: decision === 'approve' && doc.needsCfo ? data.people.cfo.name : null, mail: toPreparer, cfoMail: toCfo });
}

actionsRouter.post('/approvals/:kind/:id/approve', asyncHandler((req, res) => decide(req, res, 'approve')));
actionsRouter.post('/approvals/:kind/:id/reject', asyncHandler((req, res) => decide(req, res, 'reject')));

// A nudge to the CFO for something already signed by you.
actionsRouter.post(
  '/approvals/:kind/:id/remind',
  asyncHandler(async (req, res) => {
    const data = await getEverything(req.user);
    const doc = data.approvals.find((d) => d.kind === String(req.params.kind).toUpperCase() && d.id === req.params.id);
    if (!doc) throw new Refusal(404, 'That document is not in the approval queue.');
    if (doc.status !== 'with-cfo') throw new Refusal(409, `${doc.kindLabel} ${doc.id} is not waiting for the CFO.`);
    const mail = await sendTo({
      toName: data.people.cfo.name,
      subject: `Reminder: ${doc.kindLabel.toLowerCase()} ${doc.id} is waiting for your signature`,
      lines: [
        `${doc.kindLabel} ${doc.id}, ${doc.title}, ${money(doc.amount)}, has my approval and is waiting for yours.`,
        ...(doc.unblocks.length ? ['', `The month-end task "${doc.unblocks[0].title}" is held up until it is posted.`] : []),
        ...signOff(data.me)
      ]
    });
    saveMailLog({ by: data.me.name, at: stamp(), action: 'reminded the CFO', reference: doc.id, note: doc.title, mail });
    res.json({ saved: true, mail });
  })
);

// --- Problems ----------------------------------------------------------------------------

actionsRouter.post(
  '/problems/:id/fix',
  asyncHandler(async (req, res) => {
    const data = await getEverything(req.user);
    const problem = data.problems.find((p) => p.id === req.params.id);
    if (!problem) throw new Refusal(404, 'That problem is no longer showing. It may have been resolved in SAP.');
    if (problem.fixed) throw new Refusal(409, `Already handled by ${problem.fixed.fixedBy}.`);
    const note = String(req.body?.note || '').trim().slice(0, 500);

    const mail = await sendTo({
      toName: problem.owner.name,
      subject: `Please action: ${problem.title}`,
      lines: [
        `${problem.owner.name.replace(/^(Mr|Ms|Mrs|Dr)\.\s*/, '').split(' ')[0]},`,
        '',
        `The finance dashboard flagged this today: ${problem.title}.`,
        '',
        problem.detail,
        '',
        ...problem.evidence.map((e) => `- ${e}`),
        '',
        `What I would like done: ${problem.fix.instruction}`,
        ...(note ? ['', note] : []),
        ...signOff(data.me)
      ]
    });

    saveFix({ problemId: problem.id, fix: problem.fix.label, by: data.me.name, at: stamp(), note, reference: problem.id, mail });
    res.json({ saved: true, mail, owner: problem.owner.name });
  })
);

// --- Month-end close -----------------------------------------------------------------------

const TASK_STATES = ['done', 'in progress', 'blocked', 'not started'];

actionsRouter.post(
  '/close/:id/status',
  asyncHandler(async (req, res) => {
    const status = String(req.body?.status || '');
    if (!TASK_STATES.includes(status)) throw new Refusal(400, `Status must be one of: ${TASK_STATES.join(', ')}.`);
    const note = String(req.body?.note || '').trim().slice(0, 300);
    if (status === 'blocked' && !note) throw new Refusal(400, 'Say what it is blocked on.');

    const data = await getEverything(req.user);
    const task = data.close.tasks.find((t) => t.id === req.params.id);
    if (!task) throw new Refusal(404, 'That close task does not exist.');
    saveTaskUpdate({ taskId: task.id, status, by: data.me.name, at: stamp(), note, title: `${task.title}, unit ${task.companyCode}` });
    res.json({ saved: true });
  })
);

actionsRouter.post(
  '/close/:id/nudge',
  asyncHandler(async (req, res) => {
    const data = await getEverything(req.user);
    const task = data.close.tasks.find((t) => t.id === req.params.id);
    if (!task) throw new Refusal(404, 'That close task does not exist.');
    const mail = await sendTo({
      toName: task.owner,
      subject: `Close, working day ${task.workingDay}: ${task.title} (unit ${task.companyCode})`,
      lines: [
        `${task.owner.split(' ')[0]},`,
        '',
        `"${task.title}" for unit ${task.companyCode} was due on working day ${task.workingDay} (${dmy(task.dueDate)}) and is showing as ${task.status}.`,
        ...(task.note ? ['', `Last note: ${task.note}`] : []),
        '',
        'Can you let me know where it stands and when it will be done?',
        ...signOff(data.me)
      ]
    });
    saveMailLog({ by: data.me.name, at: stamp(), action: 'nudged a close task owner', reference: task.id, note: task.title, mail });
    res.json({ saved: true, mail });
  })
);

// --- Receivables -------------------------------------------------------------------------

const LEVEL_WORDS = {
  1: { subject: 'Friendly reminder', open: 'This is a friendly reminder that the following invoices are now past their due date.' },
  2: { subject: 'Second reminder', open: 'Despite our earlier reminder, the following invoices remain unpaid.' },
  3: { subject: 'Final reminder', open: 'This is our final reminder before we place your account on hold for new orders.' }
};

export async function sendCustomerReminder({ data, customerId, level }) {
  const c = data.receivables.customers.find((x) => x.id === customerId);
  if (!c) throw new Refusal(404, 'No such customer.');
  const overdue = data.receivables.openItems.filter((i) => i.customerId === c.id && i.daysOverdue > 0);
  if (!overdue.length) throw new Refusal(409, `${c.name} has nothing overdue.`);
  const lvl = Math.min(3, Math.max(1, Number(level) || c.reminderLevel || 1));
  const words = LEVEL_WORDS[lvl];

  const mail = await sendTo({
    toName: c.contact,
    subject: `${words.subject}: ${money(c.overdue)} overdue, InfraBeat Technologies`,
    lines: [
      `Dear ${c.contact},`,
      '',
      words.open,
      '',
      ...overdue.map((i) => `- Invoice ${i.reference}, dated ${dmy(i.invoiceDate)}, due ${dmy(i.dueDate)}: ${money(i.openAmount)}${i.disputed ? ' (under discussion)' : ''}`),
      '',
      `Total overdue: ${money(c.overdue)}.`,
      '',
      'If payment has already been made, please send us the UTR reference so we can match it. If there is a problem with any invoice, reply to this mail and we will look into it straight away.',
      '',
      'Regards,',
      data.people.ar.name,
      data.people.ar.title,
      'InfraBeat Technologies Pvt. Ltd.'
    ]
  });

  saveReminder({ customerId: c.id, level: lvl, by: data.me.name, at: stamp(), mail, value: c.overdue, customerName: c.name });
  return { customer: c, level: lvl, mail, count: overdue.length };
}

actionsRouter.post(
  '/customers/:id/remind',
  asyncHandler(async (req, res) => {
    const data = await getEverything(req.user);
    const result = await sendCustomerReminder({ data, customerId: req.params.id, level: req.body?.level });
    res.json({ saved: true, level: result.level, mail: result.mail, count: result.count });
  })
);

actionsRouter.post(
  '/customers/:id/promise',
  asyncHandler(async (req, res) => {
    const amount = Number(req.body?.amount);
    const date = String(req.body?.date || '');
    if (!(amount > 0)) throw new Refusal(400, 'Enter the amount they promised.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Refusal(400, 'Enter the date they promised to pay by.');

    const data = await getEverything(req.user);
    const c = data.receivables.customers.find((x) => x.id === req.params.id);
    if (!c) throw new Refusal(404, 'No such customer.');
    if (date < data.asOf) throw new Refusal(400, 'A promise to pay has to be for today or later.');

    const used = new Set(usedPromiseIds());
    let n = 500;
    while (used.has(`PTP-${String(n).padStart(4, '0')}`)) n += 1;
    savePromise({
      id: `PTP-${String(n).padStart(4, '0')}`,
      customerId: c.id,
      amount,
      promisedFor: date,
      by: data.me.name,
      at: stamp(),
      note: String(req.body?.note || '').trim().slice(0, 300),
      customerName: c.name
    });
    res.json({ saved: true });
  })
);

// --- Flags (used by the assistant) --------------------------------------------------------

export function flagReference({ me, reference, reason }) {
  saveFlag({ reference, reason, by: me.name, at: stamp() });
}

actionsRouter.post(
  '/flags',
  asyncHandler(async (req, res) => {
    const reference = String(req.body?.reference || '').trim();
    if (!reference) throw new Refusal(400, 'Say what to flag.');
    const data = await getEverything(req.user);
    flagReference({ me: data.me, reference, reason: String(req.body?.reason || '').slice(0, 300) });
    res.json({ saved: true });
  })
);

export { Refusal, plural };
