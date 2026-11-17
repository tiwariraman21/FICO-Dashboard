// The sample data source: the JSON files in server/data/sample.
//
// Read-only and invented. The files are dated to one fixed day (meta.asOf), and the rest of
// the backend treats that day as "today" while this provider is selected, so the overdue
// counts and the close calendar read the same whenever the demo is run.
//
// Rebuild the files with:  node server/scripts/build-sample-data.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/sample');

const cache = new Map();

async function load(file) {
  if (cache.has(file)) return structuredClone(cache.get(file));
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(folder, file), 'utf8'));
    cache.set(file, parsed);
    // A copy every time, so a caller that decorates a row cannot change what the next
    // request reads.
    return structuredClone(parsed);
  } catch (error) {
    throw new Error(
      `The sample file ${file} could not be read (${error.code || error.message}). ` +
        'Rebuild the sample data with: node server/scripts/build-sample-data.js'
    );
  }
}

export const sampleProvider = {
  name: 'sample',
  getMeta: () => load('meta.json'),
  getCustomers: () => load('customers.json'),
  getReceivables: () => load('ar-items.json'),
  getPromises: () => load('promises.json'),
  getDunningHistory: () => load('dunning-history.json'),
  getVendors: () => load('vendors.json'),
  getPayables: () => load('ap-items.json'),
  getPaymentRuns: () => load('payment-runs.json'),
  getJournalEntries: () => load('journal-entries.json'),
  getBankAccounts: () => load('bank-accounts.json'),
  getRecurringOutflows: () => load('recurring-outflows.json'),
  getCostCentres: () => load('cost-centres.json'),
  getCloseTasks: () => load('close-tasks.json'),
  getGrIr: () => load('grir.json')
};
