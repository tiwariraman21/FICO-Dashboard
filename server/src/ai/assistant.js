// The conversation: a Gemini chat session, the tool loop around it, and the pause where a
// person confirms anything that would change something.
//
// The shape, in one paragraph. A question goes to the model along with what the dashboard
// is currently showing. The model either answers, or asks for one or more tools. Read tools
// run immediately and their results go straight back in, up to five rounds - five because a
// model that has not finished looking things up after five rounds is lost, and the honest
// thing is to stop rather than spend somebody's money in a circle. An action tool does NOT
// run. The loop stops, the browser is handed a sentence describing what was asked for, and
// nothing else happens until a person presses a button.
//
// The session lives here rather than in the browser because chats.create() holds the
// history, and because a conversation that the browser could edit is a conversation anybody
// could put words into.

import { GoogleGenAI } from '@google/genai';

import { SYSTEM_PROMPT } from './system-prompt.js';
import { READ_TOOLS, ACTION_TOOLS, READ_HANDLERS, ACTION_HANDLERS, isAction, describeAction } from './tools.js';
import { readIntent } from './rules.js';
import { plural } from '../domain/format.js';
import { createGroqChat } from './groq.js';

// Which model answers, and how to reach it.
//
// Two providers rather than one, because the free tiers differ by a factor of fifty: Gemini
// allows twenty requests a day and Groq a thousand, and a demonstration that goes quiet
// after seven questions is not a demonstration. Everything above this line is the same
// either way - the tools, the prompt, the confirm step, the panel.
const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

const DEFAULT_MODEL = { gemini: 'gemini-3.6-flash', groq: 'openai/gpt-oss-120b' };

const MODEL =
  (PROVIDER === 'groq' ? process.env.GROQ_MODEL : process.env.GEMINI_MODEL) ||
  DEFAULT_MODEL[PROVIDER] ||
  DEFAULT_MODEL.gemini;

const MAX_ROUNDS = 5;

function apiKey() {
  return PROVIDER === 'groq' ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY;
}

export function assistantProvider() {
  return { provider: PROVIDER, model: MODEL };
}

// Conversations are dropped after this long unused, and the oldest goes when there are too
// many. Both are here so a demo left open overnight cannot quietly hold the process's
// memory, and neither number is interesting enough to put in the environment.
const IDLE_MINUTES = 90;
const MAX_SESSIONS = 50;

export function assistantConfigured() {
  return Boolean(apiKey());
}

let client = null;

function genai() {
  if (!client) {
    if (!assistantConfigured()) throw new Error('No API key is set for the assistant.');
    client = new GoogleGenAI({ apiKey: apiKey() });
  }
  return client;
}

// --- Logging -------------------------------------------------------------------
//
// Every question, every tool call and every answer, on the console. Asked for so the demo
// can be narrated - but it earns its place afterwards too, because "it said something odd"
// is unanswerable without a record of which tool returned what.

function log(tag, detail) {
  const at = new Date().toISOString().slice(11, 19);
  console.log(`[ask ${at}] ${tag}${detail === undefined ? '' : ` ${detail}`}`);
}

// --- Sessions ------------------------------------------------------------------

const sessions = new Map();

function sweep() {
  const cutoff = Date.now() - IDLE_MINUTES * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.lastUsed < cutoff) sessions.delete(id);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    sessions.delete(oldest[0]);
  }
}

function sessionFor(id) {
  sweep();

  const existing = sessions.get(id);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }

  // Both return the same thing to the loop below: an object with sendMessage({ message })
  // resolving to { text, functionCalls }. The loop has never needed to know which.
  const chat =
    PROVIDER === 'groq'
      ? createGroqChat({
          apiKey: apiKey(),
          model: MODEL,
          systemInstruction: SYSTEM_PROMPT,
          tools: [...READ_TOOLS, ...ACTION_TOOLS],
          log
        })
      : genai().chats.create({
          model: MODEL,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            tools: [{ functionDeclarations: [...READ_TOOLS, ...ACTION_TOOLS] }]
          }
        });

  const session = { chat, lastUsed: Date.now(), pending: null };
  sessions.set(id, session);
  log('new session', id);
  return session;
}

export function resetSession(id) {
  sessions.delete(id);
  log('session cleared', id);
}

// --- What the dashboard is showing ---------------------------------------------
//
// Sent with every message rather than once at the start, because the person changes the
// plant filter mid-conversation and the model has no way of knowing unless it is told
// again. It is cheap - one short line - and it is what makes "and for Nagpur?" work.

function currentView(filter = {}) {
  const parts = [
    `Unit filter: ${filter.companyCode && filter.companyCode !== 'all' ? `company code ${filter.companyCode}` : 'all units'}`,
    `Screen open: ${filter.screen || 'overview'}`
  ];
  return `[Dashboard is currently showing - ${parts.join('. ')}.]`;
}

// --- When the call itself fails ------------------------------------------------
//
// The SDK throws a wall of JSON. Somebody using the dashboard needs one sentence and,
// where there is one, what to do about it. The free tier matters most here: it allows
// five requests a minute and a single question spends two or three of them, so anybody
// asking two things briskly will meet this - and "429" is not an answer to anyone.

function friendlyError(problem) {
  const raw = String(problem?.message || problem || '');
  const said = /"message":\s*"([^"]+)"/.exec(raw);
  const detail = said ? said[1] : raw;

  if (problem?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    // The two free-tier limits need different sentences. A per-minute one clears while you
    // read the message; the daily one does not clear until midnight, and telling somebody
    // to try again in forty seconds when the answer is "tomorrow" wastes their afternoon.
    // The quota id is the only thing in the reply that says which it was.
    // Gemini names the quota in a quotaId; Groq says "per day" in prose. Either way the
    // question is the same one: does this clear in a minute, or tomorrow?
    const perDay = /PerDay|per day/i.test(raw);
    const limit = /"quotaValue":\s*"(\d+)"/.exec(raw);

    if (perDay) {
      return (
        `The free daily allowance for the model has run out${limit ? ` (${limit[1]} requests a day)` : ''}, ` +
        'and it does not reset until tomorrow. Answering from the dashboard rules instead.'
      );
    }

    const wait = /retry in ([\d.]+)s/i.exec(detail);
    const seconds = wait ? Math.ceil(Number(wait[1])) : null;
    return (
      'I have hit the free usage limit for this minute. ' +
      (seconds ? `Try again in about ${seconds} seconds.` : 'Try again in a minute.')
    );
  }

  // Several spellings of the same thing. A plain AIza... key that is wrong says "API key
  // not valid"; an OAuth style AQ... token that is wrong says "invalid authentication
  // credentials" instead, and reading only the first leaves somebody with a mistyped key
  // being told the model is unreachable.
  if (
    problem?.status === 401 ||
    /API key not valid|API_KEY_INVALID|unregistered callers|invalid authentication credentials|UNAUTHENTICATED/i.test(
      raw
    )
  ) {
    return `The key in ${PROVIDER === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'} was refused. Check it in .env and restart the backend.`;
  }

  if (problem?.status === 404 || /no longer available|not found/i.test(detail)) {
    return (
      `This account cannot use the model ${MODEL}. ` +
      `Set ${PROVIDER === 'groq' ? 'GROQ_MODEL' : 'GEMINI_MODEL'} in .env to one it can, then restart the backend.`
    );
  }

  return `I could not reach the model just now. ${detail}`;
}

// --- The loop ------------------------------------------------------------------

function textOf(response) {
  const text = typeof response.text === 'string' ? response.text : '';
  return text.trim();
}

// Nothing empty goes to the model.
//
// A tool result carrying "signed_by": null, "why": null and "shipment": null on each of
// thirteen rows is paying, in tokens, to say nothing thirty-nine times. On a tier metered
// at eight thousand tokens a minute that is the difference between four questions and one.
//
// Absent and null read the same to anybody, so the empties are dropped.
export function compact(value) {
  if (Array.isArray(value)) return value.map(compact);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === null || inner === undefined || inner === '') continue;
    if (Array.isArray(inner) && inner.length === 0) continue;
    out[key] = compact(inner);
  }
  return out;
}

async function runReadTools(calls, context) {
  const parts = [];

  for (const call of calls) {
    const handler = READ_HANDLERS[call.name];
    log('tool', `${call.name} ${JSON.stringify(call.args || {})}`);

    let result;
    try {
      result = handler
        ? handler(call.args || {}, context)
        : { error: `There is no tool called ${call.name}.` };
    } catch (problem) {
      // A handler that throws must not take the conversation down with it. The model is
      // told the lookup failed, which it can say out loud, rather than being left waiting.
      log('tool failed', `${call.name}: ${problem.message}`);
      result = { error: `That lookup failed: ${problem.message}` };
    }

    log('tool result', `${call.name} -> ${JSON.stringify(result).slice(0, 300)}`);
    parts.push({ functionResponse: { id: call.id, name: call.name, response: compact(result) } });
  }

  return parts;
}

/**
 * Ask a question. Returns either { kind: 'answer', text } or { kind: 'proposal', ... }.
 *
 * Never throws. A model that is out of quota, behind a bad key or simply unreachable
 * comes back as a sentence in the conversation, because that is where the person is
 * looking and a stack trace answers nothing.
 */
export async function ask(request) {
  // No key: the dashboard's own rules answer. Free, exact and offline, and they read the
  // same handlers the model would call, so the numbers agree either way.
  if (!assistantConfigured()) {
    log('question (rules)', JSON.stringify(request.question));
    return { kind: 'answer', mode: 'rules', ...readIntent(request.question, request.context, request.filter) };
  }
  try {
    return await askOnce(request);
  } catch (problem) {
    log('call failed', String(problem?.message || problem).slice(0, 200));
    return { kind: 'answer', ...withoutTheModel(problem, request), failed: true };
  }
}

// What to say when the model cannot be reached.
//
// Saying only "I could not reach the model" would be honest and useless. The dashboard's
// own parser is still here - free, exact, offline, and it already answers what is waiting,
// what is short, what is late, what is part-signed and where an order has got to. So the
// question gets asked of that instead, and the person is told which answered.
//
// This matters most on the free tier, which allows twenty requests a DAY. A demo that goes
// dead halfway through an afternoon is worse than one that never had a model at all.
function withoutTheModel(problem, { question, filter, context }) {
  const note = friendlyError(problem);

  try {
    const fallback = readIntent(question, context, filter);
    if (fallback?.text) {
      log('answered without the model', JSON.stringify(fallback.text.slice(0, 120)));
      return { text: `_${note}_\n\n${fallback.text}` };
    }
  } catch (alsoFailed) {
    log('fallback failed too', String(alsoFailed?.message || alsoFailed).slice(0, 160));
  }

  return { text: note };
}

async function askOnce({ sessionId, question, filter, context }) {
  const session = sessionFor(sessionId);
  log('question', JSON.stringify(question));

  let response = await session.chat.sendMessage({
    message: `${currentView(filter)}\n\n${question}`
  });

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const calls = response.functionCalls || [];
    if (calls.length === 0) break;

    // An action stops everything. Even when the model asks for it alongside a read, the
    // whole turn pauses: carrying out half of what it asked for and then waiting would
    // leave the conversation describing a state that only partly happened.
    const action = calls.find((call) => isAction(call.name));
    if (action) {
      const described = describeAction(action.name, action.args || {}, context);
      session.pending = { id: action.id, name: action.name, args: action.args || {} };
      log('proposed', `${action.name} ${JSON.stringify(action.args || {})}`);

      return {
        kind: 'proposal',
        summary: described.summary,
        detail: described.detail,
        confirmLabel: described.confirmLabel,
        tool: action.name
      };
    }

    const parts = await runReadTools(calls, context);
    response = await session.chat.sendMessage({ message: parts });
  }

  if (response.functionCalls?.length) {
    log('gave up', `still calling tools after ${MAX_ROUNDS} rounds`);
    return {
      kind: 'answer',
      text: 'I could not get to an answer on that one. Try asking it a different way, or more narrowly.'
    };
  }

  const text = textOf(response) || 'I have nothing to add to that.';
  log('answer', JSON.stringify(text.slice(0, 200)));
  return { kind: 'answer', mode: 'model', text };
}

/**
 * Carry out - or decline - whatever was proposed, then let the model say what happened.
 */
export async function confirm({ sessionId, approved, context }) {
  const session = sessions.get(sessionId);
  if (!session || !session.pending) {
    return { kind: 'answer', text: 'That is no longer waiting to be confirmed. Ask me again and I will set it up.' };
  }

  const pending = session.pending;
  session.pending = null;
  session.lastUsed = Date.now();

  let result;
  if (!approved) {
    log('declined', pending.name);
    result = { done: false, declined: true, message: 'The person declined. Nothing was done.' };
  } else {
    log('confirmed', `${pending.name} ${JSON.stringify(pending.args)}`);
    try {
      result = await ACTION_HANDLERS[pending.name](pending.args, context);
    } catch (problem) {
      log('action failed', `${pending.name}: ${problem.message}`);
      result = { done: false, message: `That did not go through: ${problem.message}` };
    }
    log('action result', JSON.stringify({ ...result, content: undefined }));
  }

  // The file itself never goes to the model - only whether it was produced. Sending a
  // spreadsheet through a language model to have it described back is paying twice for
  // something the browser already has.
  const { content, ...forModel } = result;

  let spoken = null;
  try {
    const response = await session.chat.sendMessage({
      message: [{ functionResponse: { id: pending.id, name: pending.name, response: forModel } }]
    });
    spoken = textOf(response);
  } catch (problem) {
    // It has already been done. Losing the model here changes nothing about that, so
    // the handler's own sentence is what gets said - never silence, and never a claim
    // that it did not happen.
    log('call failed after acting', String(problem?.message || problem).slice(0, 200));
  }

  return {
    kind: 'answer',
    text: spoken || result.message,
    result: { ...result, tool: pending.name }
  };
}

// --- Opening lines -------------------------------------------------------------
//
// Read straight off the data, without the model.
//
// The brief says to call the read tools once and offer two or three specific lines. Putting
// a language model between the data and a sentence like "4 orders have been pending over 7
// days" buys nothing and risks the one thing the whole feature must not do, which is state
// a number that is not true. So these are computed, and they are exact.

export function openers(data) {
  const lines = [];

  const mine = data.approvals.filter((d) => d.status === 'with-you');
  const risky = mine.filter((d) => d.tone === 'neg');
  if (risky.length) {
    lines.push({
      text: `${plural(risky.length, 'document')} waiting for you ${risky.length === 1 ? 'has' : 'have'} a problem to settle first`,
      ask: 'Which approvals waiting for me have problems, and what are they?'
    });
  } else if (mine.length) {
    lines.push({ text: `${plural(mine.length, 'document')} waiting for your signature`, ask: 'What is waiting for my approval?' });
  }

  const short = Object.values(data.cash).filter((f) => f.firstShortWeek);
  if (short.length) {
    const f = short[0];
    const name = data.companyCodes.find((c) => c.code === f.companyCode)?.name;
    lines.push({ text: `${name} runs out of cash headroom in the week of ${f.firstShortWeek}`, ask: `What does the cash forecast look like for ${name}?` });
  }

  const worst = data.receivables.customers.find((c) => c.band === 'high');
  if (worst) {
    lines.push({ text: `${worst.name}: ${worst.reasons[0]}`, ask: `What is the position with ${worst.name}?` });
  }

  const msme = data.payables.openItems.filter((i) => i.msmeBreached && !i.inRun);
  if (lines.length < 3 && msme.length) {
    lines.push({ text: `${plural(msme.length, 'MSME invoice')} past 45 days and in no payment run`, ask: 'Which MSME invoices are past 45 days?' });
  }

  log('openers', `${lines.length} available`);
  return lines.slice(0, 3);
}
