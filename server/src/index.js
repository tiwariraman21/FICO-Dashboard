// Entry point for the backend.
//
// The browser never calls SAP directly, because that would ship the API key to every
// visitor's laptop. The React app calls this Express server, and only this server holds the
// credentials and talks to SAP.

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, hasSapKey, authConfigured } from './config.js';
import { requireSignIn } from './auth.js';
import { verifyMail, mailConfigured, mailSwitchedOff } from './mailer.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { actionsRouter } from './routes/actions.js';
import { assistantRouter } from './routes/assistant.js';
import { openStore } from './store.js';

// Refuse to start rather than serve the company's ledgers to anyone who finds the port.
if (!authConfigured) {
  console.error('');
  console.error('[api] Cannot start: sign-in is not configured.');
  console.error('[api] Your .env needs both of these:');
  console.error('[api]   AUTH_USERNAME=you@example.com');
  console.error('[api]   AUTH_PASSWORD_HASH=scrypt$...');
  console.error('[api] Generate the hash with:');
  console.error('[api]   node server/scripts/hash-password.js "your password"');
  console.error('');
  process.exit(1);
}

// Creates the local SQLite file on first run. Doing it here rather than lazily means a
// permissions problem is reported at boot, not on the first approval.
openStore();

const app = express();
app.use(express.json({ limit: '1mb' }));

// Open routes: checking the backend is alive, and signing in.
app.use('/api', healthRouter);
app.use('/api', authRouter);

// Everything below requires a signed-in session. A route added after this line is protected
// by default, which is the right way round.
app.use('/api', requireSignIn);

app.use('/api', dashboardRouter);
app.use('/api', actionsRouter);
app.use('/api', assistantRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// Serving the built React app, so the whole thing is one process on one port.
const thisFolder = path.dirname(fileURLToPath(import.meta.url));
const builtApp = path.resolve(thisFolder, '../../web/dist');
const hasBuiltApp = fs.existsSync(path.join(builtApp, 'index.html'));

if (hasBuiltApp) {
  app.use(express.static(builtApp));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(builtApp, 'index.html'));
  });
}

// The message is written for a person to read, so it is safe to show on screen. Never put
// a stack trace or a credential in here - this text reaches the browser.
app.use((err, req, res, next) => {
  console.error('[api] unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong on the server' });
});

app.listen(config.port, '0.0.0.0', async () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(
    hasBuiltApp
      ? '[api] serving the dashboard from web/dist'
      : '[api] no built app found. Run `npm run build`, or `npm run dev` for the development server on port 5173.'
  );
  console.log(`[api] data source: ${config.dataSource}`);
  console.log(`[api] SAP API key loaded: ${hasSapKey ? 'yes' : 'no'}`);
  console.log(
    `[api] sign-in required as: ${config.auth.username}` +
      (config.auth.displayName ? ` (recorded as "${config.auth.displayName}")` : '')
  );

  if (!mailConfigured()) {
    console.log(
      mailSwitchedOff()
        ? '[api] email: SWITCHED OFF (MAIL_ENABLED=false). Everything still saves; nothing is sent.'
        : '[api] email: not configured, actions will save but send nothing'
    );
  } else {
    const result = await verifyMail();
    console.log(result.ok ? `[api] email: ready, sending as ${config.mail.user}` : `[api] email: NOT WORKING - ${result.reason}`);
  }
});
