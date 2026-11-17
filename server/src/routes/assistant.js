// The assistant's routes. Behind the same sign-in as everything else, because a
// conversation that can read the ledgers and send mail is not less sensitive than the
// ledgers.

import { Router } from 'express';
import { asyncHandler } from './helpers.js';
import { getEverything } from '../data-service.js';
import { config } from '../config.js';
import { ask, confirm, openers, resetSession, assistantConfigured, assistantProvider } from '../ai/assistant.js';

export const assistantRouter = Router();

// Rebuilt per request: a person approves things while the panel is open, and a
// conversation answering from a snapshot would describe a document that has since moved.
const contextFor = (req) => getEverything(req.user);
const sessionIdFor = (req) => `user:${req.user?.username || 'anonymous'}`;

assistantRouter.get('/assistant/status', (req, res) => {
  res.json({
    available: true,
    mode: assistantConfigured() ? 'model' : 'rules',
    ...assistantProvider(),
    mailEnabled: config.mail.enabled
  });
});

assistantRouter.get(
  '/assistant/openers',
  asyncHandler(async (req, res) => {
    res.json({ openers: openers(await contextFor(req)) });
  })
);

assistantRouter.post(
  '/assistant/ask',
  asyncHandler(async (req, res) => {
    const question = String(req.body?.question || '').trim().slice(0, 1000);
    if (!question) {
      res.status(400).json({ error: 'Ask me something.' });
      return;
    }
    const result = await ask({ sessionId: sessionIdFor(req), question, filter: req.body?.filter || {}, context: await contextFor(req) });
    res.json(result);
  })
);

// The only way an action ever runs. The browser cannot name the action or its arguments;
// it can only say yes or no to the one the server is already holding.
assistantRouter.post(
  '/assistant/confirm',
  asyncHandler(async (req, res) => {
    const result = await confirm({ sessionId: sessionIdFor(req), approved: req.body?.approved !== false, context: await contextFor(req) });
    res.json(result);
  })
);

assistantRouter.post('/assistant/reset', (req, res) => {
  resetSession(sessionIdFor(req));
  res.json({ cleared: true });
});
