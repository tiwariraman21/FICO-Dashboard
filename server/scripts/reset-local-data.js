// Deletes the dashboard's own records (approvals, fixes, reminders, close-task updates) so a
// demo starts clean. The sample data itself is untouched.
//
//   node server/scripts/reset-local-data.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db');
let removed = 0;
for (const name of ['fico.db', 'fico.db-wal', 'fico.db-shm']) {
  const file = path.join(folder, name);
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    removed += 1;
  }
}
console.log(removed ? 'Local decisions cleared. Restart the backend.' : 'Nothing to clear.');
