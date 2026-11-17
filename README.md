# FICO_Infrabeat — Finance dashboard

The finance (SAP FI/CO) version of the InfraBeat procurement dashboard. It uses the same
architecture, look and safety rules. It is built for a Finance Controller and puts the
day's finance decisions on one screen:

| Screen | What it answers |
|---|---|
| **Overview** | What needs my signature, how much cash there is, who to chase, how the close is going |
| **Approvals** | Parked journal entries, blocked supplier invoices and payment runs in one queue. Each item has been checked already, shows who signs before and after you, and says what happens if you approve or send it back |
| **Receivables** | Ageing, DSO, credit-limit use, payment behaviour, promises to pay; send a reminder or record a promise |
| **Payables** | Due and overdue invoices, blocked invoices, MSME 45-day watch list, early-payment discounts, supplier bank changes |
| **Cash** | Bank balances today and an 8-week forecast built from the open items, per company code |
| **Budgets** | Cost centre spend against plan year to date, with a full-year estimate at the current run rate |
| **October close** | The month-end checklist by working day: late, blocked, and tasks waiting on your approval |
| **Problems found** | Checks run every time the dashboard loads, each with evidence, an owner and a suggested fix |
| **Ask** | The assistant. It answers from fixed rules with no key, or holds a conversation with a Groq/Gemini key |

## Run it

Needs Node 22.5 or later, because it uses the built-in `node:sqlite`.

```bash
npm install
cp .env.example .env
node server/scripts/hash-password.js "choose a password"   # paste the line it prints into .env
npm start                                                   # builds the React app, then serves on :3001
```

Open http://localhost:3001 and sign in with `AUTH_USERNAME` and the password you chose.
For development with hot reload: `npm run dev` (web on :5173, API on :3001).

* `npm run reset` clears every approval, fix and reminder recorded in `db/fico.db`, so a
  demo starts clean.
* `npm run sample-data` rebuilds the sample data. The data is deterministic, so the same
  numbers come out every time.

## How it is put together

```
server/src
  providers/        where data comes FROM. sample-provider (JSON) today; sap-provider stubs
                    name the S/4HANA OData service for every method
  domain/           the finance rules: receivables, payables (MSME, duplicates), approvals
                    (checks per document), cash forecast, budgets, close, problems
  data-service.js   reads the provider, lays the dashboard's own decisions over it, runs the rules
  store.js          SQLite (db/fico.db): approvals, fixes, reminders, promises, close updates, audit log
  routes/           dashboard, actions (approve / reject / fix / remind / nudge), assistant, auth
  ai/               tool definitions, rules fallback, Groq/Gemini loop, system prompt
  mailer.js         SMTP; recipients resolved server-side from MAIL_DIRECTORY
web/src
  screens/          one file per tab
  components/       ui kit and styles carried over from procurement, plus finance-charts.jsx
```

The rules carried over from the procurement dashboard:

* **SAP field names stay in `sap-provider.js`.** Every other file uses plain business terms,
  so connecting live SAP means changing that one file.
* **The browser never talks to SAP** and never sees an email address. It sends a person's
  name, and the server looks up the address.
* **Saving comes before mail.** A mail failure can never lose a decision.
* **The assistant cannot approve, post or pay anything.** It can send a payment reminder,
  export a CSV or flag an item, and it describes each one first so you can confirm or cancel.
* **Nobody signs for someone else.** If a document needs the CFO, you approve your own
  step and the dashboard offers *Remind the CFO*. It never records the CFO's signature.

## About the sample data

The data is invented and dated **9 November 2026**. While it is selected, the dashboard
treats that date as today, so ageing and the close calendar stay the same between demos,
and the header says so. Some situations are planted on purpose so the checks have
something to find:

* Bharat Bearings invoice entered twice (`BB/2231/26-27` and `BB-2231/26-27`), both in the Pune run
* Swift Freight changed bank account 3 days before the Nagpur run
* Nagpur run needs ₹3.24 cr against ₹2.50 cr available
* Vindhya Logistics MSME invoice at 47 days, left out of the Mumbai run
* Harbourline and Gateway over their credit limits; Thane Urban broke a promise to pay
* A depreciation correction posted at 23:41 on a Sunday with no attachment
* Mumbai logistics 16.6% over budget; Nagpur bank reconciliation blocked on a missing statement

## Connecting live SAP

1. Fill in the methods in `server/src/providers/sap-provider.js`. Each one names the service it
   should read: `API_OPLACCTGDOCITEMCUBE_SRV` for AR/AP items, `API_BUSINESS_PARTNER`,
   `API_SUPPLIERINVOICE_PROCESS_SRV`, `API_JOURNALENTRYITEMBASIC_SRV` and so on. Check each one
   against the customer's release and activation. For ECC, use the BAPIs noted in that file.
2. Some data needs a custom CDS view because SAP has no standard OData read for it: the F110
   payment proposal, parked documents and bank change dates. The stubs say which.
3. Approve and release actions should then also call SAP: post the parked document, remove the
   payment block, release the proposal. `store.js` stays as the audit trail.
4. Set `DATA_SOURCE=sap` and `SAP_API_KEY` in `.env`.

Data a typical SAP system does not hold (salary and GST outflows, the close checklist) falls
back to the sample files. Real sources would be a planning sheet or SAP Advanced Financial
Closing.
