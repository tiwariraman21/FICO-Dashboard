// The live data source. Not built yet.
//
// Written now, empty, because it makes the shape of the remaining work visible. Each method
// names the S/4HANA service it will read, and the few that fall back to the sample files
// mark exactly where this dashboard shows something SAP cannot provide by itself.
//
// SAP terms in this file are deliberate. This is the one layer allowed to know them,
// because its whole job is translating them into the plain business shapes in provider.js.
// Nothing above this layer, and nothing on screen, should ever say "A_OperationalAcctgDocItemCube".
//
// Service names below are the standard S/4HANA Cloud / on-premise OData APIs as published on
// the SAP Business Accelerator Hub (api.sap.com). Check each against the customer's release
// and whether it is activated in /IWFND/MAINT_SERVICE before relying on it. For an ECC
// system, the same data comes from RFC-enabled BAPIs instead (noted per method).

import { config } from '../config.js';
import { sampleProvider } from './sample-provider.js';

function notBuiltYet(what, service) {
  return new Error(
    `Live ${what} is not built yet. It will read ${service}. ` + 'Set DATA_SOURCE=sample in your .env to use the sample data.'
  );
}

// The one place a request to SAP will be made. Kept here, unused, so the authentication
// and error handling are written once when the methods below are filled in.
// eslint-disable-next-line no-unused-vars
async function odata(service, entity, query = '') {
  const url = `${config.sap.baseUrl}${service}/${entity}${query ? `?${query}` : ''}`;
  const response = await fetch(url, {
    headers: { APIKey: config.sap.apiKey, Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`SAP replied ${response.status} for ${service}/${entity}`);
  const body = await response.json();
  return body?.d?.results || body?.value || [];
}

export const sapProvider = {
  name: 'sap',

  async getMeta() {
    // Company codes: API_COMPANYCODE_SRV (A_CompanyCode). Fiscal year variant and posting
    // periods have no standard OData read; T009B / OB52 would need a small custom CDS view.
    // asOf is null: with live data, today is today.
    const meta = await sampleProvider.getMeta();
    return { ...meta, asOf: null };
  },

  async getCustomers() {
    // API_BUSINESS_PARTNER (A_Customer, A_CustomerCompany for payment terms and dunning
    // procedure). Credit limits live in SAP Credit Management: API_CRDTMBUSINESSPARTNER
    // (A_CreditManagementAccount). ECC: BAPI_CUSTOMER_GETDETAIL2 plus KNKK.
    throw notBuiltYet('customer data', 'API_BUSINESS_PARTNER and API_CRDTMBUSINESSPARTNER');
  },

  async getReceivables() {
    // API_OPLACCTGDOCITEMCUBE_SRV (A_OperationalAcctgDocItemCube), filtered to
    // FinancialAccountType eq 'D'. Open items have ClearingAccountingDocument blank.
    // ECC: BAPI_AR_ACC_GETOPENITEMS and BAPI_AR_ACC_GETCLEAREDITEMS.
    throw notBuiltYet('receivables', 'API_OPLACCTGDOCITEMCUBE_SRV');
  },

  async getPromises() {
    // Promises to pay are recorded in SAP Collections Management (FSCM) when it is in use.
    // Most customers do not run it, so these are kept by the dashboard itself.
    return [];
  },

  async getDunningHistory() {
    // Dunning notices: no standard OData read. MHNK/MHND via a custom CDS view, or keep
    // the dashboard's own reminder log (which this version already does).
    return [];
  },

  async getVendors() {
    // API_BUSINESS_PARTNER (A_Supplier, A_SupplierCompany, A_BusinessPartnerBank). MSME
    // registration is usually held in a custom field or the supplier's classification;
    // ask the customer where theirs is. Bank change dates come from change documents
    // (CDHDR/CDPOS for object class BUPA_BUP or KRED) - a custom read.
    throw notBuiltYet('vendor data', 'API_BUSINESS_PARTNER');
  },

  async getPayables() {
    // Posted and blocked invoices: API_OPLACCTGDOCITEMCUBE_SRV with FinancialAccountType
    // eq 'K'. Logistics invoices with their block reason: API_SUPPLIERINVOICE_PROCESS_SRV
    // (A_SupplierInvoice). Parked invoices appear there with status 'parked'.
    throw notBuiltYet('payables', 'API_OPLACCTGDOCITEMCUBE_SRV and API_SUPPLIERINVOICE_PROCESS_SRV');
  },

  async getPaymentRuns() {
    // The F110 proposal (REGUH/REGUP) has no standard OData service. Options: a custom CDS
    // view over the proposal tables, or the Manage Automatic Payments app's own service.
    throw notBuiltYet('payment proposals', 'a custom read of the F110 proposal');
  },

  async getJournalEntries() {
    // Parked documents waiting for approval. In S/4HANA Cloud, the Verify General Journal
    // Entries workflow; on-premise, parked documents (VBKPF/VBSEGS) via a custom CDS view.
    throw notBuiltYet('parked journal entries', 'the journal entry verification workflow');
  },

  async getBankAccounts() {
    // Balances: API_BANKSTATEMENT_SRV for the latest statement, or the cash position from
    // Cash Management (API_CASHPOSITION if licensed). House bank accounts: API_HOUSEBANK_SRV.
    throw notBuiltYet('bank balances', 'the bank statement and house bank services');
  },

  async getRecurringOutflows() {
    // Salaries, GST and TDS are not open items until they are posted. A planning sheet or
    // SAP Cash Management planning levels would hold them; the sample list stands in.
    return sampleProvider.getRecurringOutflows();
  },

  async getCostCentres() {
    // Actuals: API_JOURNALENTRYITEMBASIC_SRV (or the ACDOCA-based cube) grouped by cost
    // centre and period. Plan: API_FINPLANNINGDATA_SRV if plans are in S/4, otherwise the
    // planning tool the customer uses (SAC, BPC).
    throw notBuiltYet('budget data', 'API_JOURNALENTRYITEMBASIC_SRV and the plan data');
  },

  async getCloseTasks() {
    // SAP Advanced Financial Closing has its own API. Without it, the close checklist is
    // usually a spreadsheet; the sample list stands in.
    return sampleProvider.getCloseTasks();
  },

  async getGrIr() {
    // GR/IR clearing account open items: API_OPLACCTGDOCITEMCUBE_SRV filtered to the
    // GR/IR account, joined to the purchase order history (API_PURCHASEORDER_PROCESS_SRV).
    throw notBuiltYet('GR/IR items', 'API_OPLACCTGDOCITEMCUBE_SRV');
  }
};
