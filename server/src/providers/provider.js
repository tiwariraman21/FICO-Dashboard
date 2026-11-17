// THE INTERFACE. This file defines the contract and holds no working code.
//
// Every data source - the sample files today, live SAP tomorrow - must offer exactly these
// methods and return exactly these shapes. Because they all keep that promise, the rest of
// the backend can call getReceivables() without knowing whether the answer came from a
// JSON file on this laptop or an S/4HANA system on the other side of the country.
//
// The shapes are BUSINESS shapes, not SAP shapes. SapProvider's whole job is translating
// BSID/BSAD, ACDOCA and the OData field names into these. If SAP's names leaked through to
// here, every screen would have to change the day the company moves to a different system.
//
//   getMeta()               -> { asOf | null, fiscal, companyCodes, people, glAccounts }
//   getCustomers()          -> [ Customer ]        master data incl. credit limit and terms
//   getReceivables()        -> [ ArItem ]          open AND cleared customer items
//   getPromises()           -> [ PromiseToPay ]
//   getDunningHistory()     -> [ DunningNotice ]
//   getVendors()            -> [ Vendor ]          incl. MSME category and bank change date
//   getPayables()           -> [ ApItem ]          open, blocked and paid supplier invoices
//   getPaymentRuns()        -> [ PaymentProposal ] proposals waiting to be released
//   getJournalEntries()     -> [ ParkedEntry ]     journal entries parked for approval
//   getBankAccounts()       -> [ BankAccount ]
//   getRecurringOutflows()  -> [ RecurringOutflow ] salaries, GST, TDS, loan instalments
//   getCostCentres()        -> [ CostCentre ]      plan and actual by period
//   getCloseTasks()         -> [ CloseTask ]       the month-end close checklist
//   getGrIr()               -> [ GrIrItem ]        open GR/IR clearing items
//
// All are async, because the SAP versions are network calls.

export const REQUIRED_METHODS = [
  'getMeta',
  'getCustomers',
  'getReceivables',
  'getPromises',
  'getDunningHistory',
  'getVendors',
  'getPayables',
  'getPaymentRuns',
  'getJournalEntries',
  'getBankAccounts',
  'getRecurringOutflows',
  'getCostCentres',
  'getCloseTasks',
  'getGrIr'
];

export function assertValidProvider(provider, name) {
  const missing = REQUIRED_METHODS.filter((m) => typeof provider[m] !== 'function');
  if (missing.length > 0) {
    throw new Error(`The ${name} data source is missing these methods: ${missing.join(', ')}`);
  }
}
