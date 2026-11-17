// Chooses which data source the backend reads from, based on DATA_SOURCE in .env.
//
// The only file that knows both providers exist. Switching to live SAP data is a one-line
// change in a settings file rather than a hunt through the codebase.

import { config, hasSapKey } from '../config.js';
import { sampleProvider } from './sample-provider.js';
import { sapProvider } from './sap-provider.js';
import { assertValidProvider } from './provider.js';

const providers = { sample: sampleProvider, sap: sapProvider };

const selected = providers[config.dataSource];

if (!selected) {
  throw new Error(`DATA_SOURCE in your .env is "${config.dataSource}", which is not a data source. Use "sample" or "sap".`);
}

assertValidProvider(selected, config.dataSource);

if (config.dataSource === 'sap' && !hasSapKey) {
  throw new Error('DATA_SOURCE is "sap" but SAP_API_KEY is missing from your .env. Add the key, or set DATA_SOURCE=sample.');
}

export function getProvider() {
  return selected;
}
