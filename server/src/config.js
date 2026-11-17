// Reads configuration once, at startup, and hands it to the rest of the backend.
// Nothing else in the codebase should touch process.env directly - that way there is
// exactly one place to look when you wonder "where does this setting come from?".

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const thisFolder = path.dirname(fileURLToPath(import.meta.url));

// .env sits at the repo root, two levels up from server/src. npm runs the backend with
// server/ as the working directory, so dotenv's default would miss it.
dotenv.config({ path: path.resolve(thisFolder, '../../.env') });

// Turns MAIL_DIRECTORY into a name-to-address map. A bad value is a warning, never a crash:
// with no directory every notification simply goes to MAIL_TO, saying who it was for.
function parseDirectory(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('it must be a JSON object of "Name": "address" pairs');
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([name, address]) => name.trim() && typeof address === 'string' && address.includes('@'))
    );
  } catch (error) {
    console.error(`[api] MAIL_DIRECTORY could not be read, so no real mailboxes are known: ${error.message}`);
    return {};
  }
}

export const config = {
  port: Number(process.env.PORT) || 3001,

  // Where the finance data is read from.
  //   sample - the invented data set in server/data/sample. Dated to a fixed day.
  //   sap    - the live S/4HANA OData services. Stubs only in this version.
  //
  // Writes (approvals, fixes, reminders, close-task updates) always go to the local SQLite
  // file in db/, whichever is chosen. See server/src/store.js for why.
  dataSource: (process.env.DATA_SOURCE || 'sample').toLowerCase(),

  sap: {
    baseUrl: process.env.SAP_BASE_URL || 'https://sandbox.api.sap.com/s4hanacloud/sap/opu/odata/sap/',
    apiKey: process.env.SAP_API_KEY || ''
  },

  auth: {
    username: process.env.AUTH_USERNAME || '',
    displayName: process.env.AUTH_DISPLAY_NAME || '',
    passwordHash: process.env.AUTH_PASSWORD_HASH || '',
    secureCookie: process.env.AUTH_SECURE_COOKIE === 'true'
  },

  // Approval limits, in rupees. Above these a second signature, the CFO's, is needed.
  // Kept in configuration because they are company policy, not code.
  limits: {
    journalEntry: Number(process.env.LIMIT_JOURNAL_ENTRY) || 50 * 100000,
    invoiceRelease: Number(process.env.LIMIT_INVOICE_RELEASE) || 1 * 10000000,
    paymentRun: Number(process.env.LIMIT_PAYMENT_RUN) || 3 * 10000000
  },

  mail: {
    host: process.env.MAIL_HOST || '',
    port: Number(process.env.MAIL_PORT) || 587,
    user: process.env.MAIL_USER || '',
    password: process.env.MAIL_PASSWORD || '',
    from: process.env.MAIL_FROM || '',
    // The catch-all. A notification for somebody with no mailbox in MAIL_DIRECTORY comes
    // here instead, with a line at the top naming who it was meant for.
    to: process.env.MAIL_TO || '',
    noReply: process.env.MAIL_NO_REPLY || process.env.MAIL_USER || '',
    directory: parseDirectory(process.env.MAIL_DIRECTORY),
    enabled: process.env.MAIL_ENABLED !== 'false'
  }
};

export const authConfigured = Boolean(config.auth.username && config.auth.passwordHash);

export const hasSapKey = config.sap.apiKey.length > 0 && config.sap.apiKey !== 'paste-your-sandbox-api-key-here';
