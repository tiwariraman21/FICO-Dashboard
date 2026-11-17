// Builds the sample finance data in server/data/sample.
//
// Deterministic: a seeded random number generator means every run produces exactly the
// same files, so a number quoted in a demo script is still true after a rebuild.
//
// Everything is dated against one fixed "as of" day (AS_OF below). The dashboard treats
// that day as today when it shows sample data, so the ageing, the overdue counts and the
// close calendar never drift as real time passes. With live SAP data, today is today.
//
// Nothing in here is real. The customers, vendors, people, bank accounts and GSTINs are
// invented; a few situations are planted on purpose so the problem checks have something
// to find (a duplicate invoice, a vendor whose bank details just changed, an MSME invoice
// past 45 days, a customer over their credit limit, and so on). Each plant is marked
// PLANTED below.
//
// Run from the project root:   node server/scripts/build-sample-data.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/sample');
fs.mkdirSync(OUT, { recursive: true });

export const AS_OF = '2026-11-09';

// --- Helpers -----------------------------------------------------------------

let seed = 20261109;
function rand() {
  // mulberry32
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function normal(mean, sd) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const base = new Date(`${AS_OF}T00:00:00Z`);
function day(offset) {
  const d = new Date(base.getTime() + Math.round(offset) * 86400000);
  return d.toISOString().slice(0, 10);
}
// The nearest working day on or before an offset, for timestamps people made at work.
function weekday(offset) {
  let o = offset;
  while ([0, 6].includes(new Date(`${day(o)}T00:00:00Z`).getUTCDay())) o -= 1;
  return day(o);
}
function between(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}
const roundTo = (n, step) => Math.round(n / step) * step;
const L = 100000; // one lakh
const CR = 10000000; // one crore

function write(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + '\n');
}

// --- Organisation -------------------------------------------------------------

const companyCodes = [
  { code: '1000', name: 'Pune', legalName: 'InfraBeat Technologies Pvt. Ltd., Pune unit', city: 'Pune', currency: 'INR' },
  { code: '2000', name: 'Mumbai', legalName: 'InfraBeat Technologies Pvt. Ltd., Mumbai unit', city: 'Mumbai', currency: 'INR' },
  { code: '3000', name: 'Nagpur', legalName: 'InfraBeat Technologies Pvt. Ltd., Nagpur unit', city: 'Nagpur', currency: 'INR' }
];

const people = {
  you: { name: 'Meera K', title: 'Finance Controller' },
  cfo: { name: 'Ms. Nandini Rao', title: 'Chief Financial Officer' },
  ap: { name: 'Rohit Kulkarni', title: 'Accounts Payable Lead' },
  ar: { name: 'Sneha Patil', title: 'Receivables and Credit Lead' },
  gl: { name: 'Amit Joshi', title: 'General Ledger Lead' },
  co: { name: 'Priya Deshpande', title: 'Controlling Lead' },
  tax: { name: 'Farhan Shaikh', title: 'Indirect Tax Manager' },
  treasury: { name: 'Kavita Menon', title: 'Treasury Manager' },
  acc1: { name: 'Sanjay Pawar', title: 'Accountant, Nagpur' },
  acc2: { name: 'Neha Gokhale', title: 'Accountant, Mumbai' },
  buyer: { name: 'Mr. Anil Deshmukh', title: 'Procurement desk lead' }
};

const fiscal = {
  // Indian financial year, April to March. October is period 07.
  year: '2026-27',
  currentPeriod: 8,
  closingPeriod: 7,
  closingPeriodLabel: 'October 2026',
  periods: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
};

const glAccounts = [
  ['110100', 'Bank, current accounts', 'BS'],
  ['110900', 'Cash credit facility', 'BS'],
  ['140000', 'Trade receivables', 'BS'],
  ['140500', 'GST input credit', 'BS'],
  ['150100', 'Prepaid insurance', 'BS'],
  ['160000', 'GR/IR clearing', 'BS'],
  ['170100', 'Intercompany receivable', 'BS'],
  ['180100', 'Accumulated depreciation', 'BS'],
  ['199999', 'Suspense account', 'BS'],
  ['210000', 'Trade payables', 'BS'],
  ['220100', 'Accrued expenses', 'BS'],
  ['220200', 'Provision for bonus', 'BS'],
  ['230100', 'GST output payable', 'BS'],
  ['231000', 'TDS payable', 'BS'],
  ['270100', 'Intercompany payable', 'BS'],
  ['410000', 'Sales, cement', 'PL'],
  ['510000', 'Raw material consumed', 'PL'],
  ['520000', 'Power and fuel', 'PL'],
  ['530000', 'Freight outward', 'PL'],
  ['540000', 'Repairs and maintenance', 'PL'],
  ['550000', 'Salaries and wages', 'PL'],
  ['550500', 'Bonus', 'PL'],
  ['560000', 'Professional and IT services', 'PL'],
  ['570000', 'Insurance', 'PL'],
  ['580000', 'Depreciation', 'PL'],
  ['590000', 'Bad debts written off', 'PL'],
  ['595000', 'Foreign exchange loss', 'PL']
].map(([gl, name, type]) => ({ gl, name, type }));

// --- Customers and receivables --------------------------------------------------

// monthly = average monthly billing in lakh. late = how many days past due they usually pay.
const customerProfiles = [
  ['C100001', 'Sahyadri Infra Projects Pvt. Ltd.', 'Pune', '1000', 400, 45, 8, 6, 1400, 'Infrastructure contractor', 'Mr. Ketan Bhosale'],
  ['C100002', 'Deccan Ready-Mix Concrete', 'Pune', '1000', 260, 30, 3, 4, 700, 'Ready-mix concrete', 'Ms. Aarti Jadhav'],
  ['C100003', 'Shivneri Housing LLP', 'Pune', '1000', 90, 30, 12, 8, 300, 'Housing developer', 'Mr. Vivek Shinde'],
  ['C100004', 'Pune Metro Precast Pvt. Ltd.', 'Pune', '1000', 300, 60, 5, 5, 1100, 'Precast elements', 'Mr. Rahul Gadgil'],
  ['C100005', 'Indrayani Builders', 'Pimpri', '1000', 60, 30, 25, 15, 200, 'Builder', 'Mr. Santosh Kale'],
  ['C100006', 'Western Ghats Roadways Ltd.', 'Satara', '1000', 290, 45, 15, 10, 1000, 'Road contractor', 'Mr. Prakash More'],
  ['C200001', 'Konkan Coastal Builders', 'Ratnagiri', '2000', 330, 45, 6, 5, 1100, 'Builder', 'Mr. Nitin Sawant'],
  ['C200002', 'Harbourline Constructions Ltd.', 'Mumbai', '2000', 520, 60, 28, 10, 1400, 'Infrastructure contractor', 'Mr. Farokh Irani'],
  ['C200003', 'Thane Urban Developers', 'Thane', '2000', 160, 30, 18, 12, 600, 'Housing developer', 'Mr. Manoj Pathak'],
  ['C200004', 'Navi Mumbai Precast Works', 'Navi Mumbai', '2000', 140, 45, 2, 3, 500, 'Precast elements', 'Ms. Rekha Nair'],
  ['C200005', 'Gateway Infra Traders', 'Mumbai', '2000', 90, 21, 55, 20, 250, 'Cement dealer', 'Mr. Imran Qureshi'],
  ['C200006', 'Salsette Realty Pvt. Ltd.', 'Mumbai', '2000', 230, 45, 9, 6, 800, 'Housing developer', 'Mr. Cyrus Mistry-Rao'],
  ['C300001', 'Vidarbha Highways Ltd.', 'Nagpur', '3000', 420, 60, 22, 8, 1500, 'Road contractor', 'Mr. Ashok Wankhede'],
  ['C300002', 'Orange City Ready-Mix', 'Nagpur', '3000', 150, 30, 4, 4, 400, 'Ready-mix concrete', 'Ms. Pooja Thakre'],
  ['C300003', 'Wardha Valley Cement Traders', 'Wardha', '3000', 60, 21, 30, 15, 200, 'Cement dealer', 'Mr. Rajesh Dhote'],
  ['C300004', 'Chandrapur Power Projects Ltd.', 'Chandrapur', '3000', 300, 45, 10, 7, 1000, 'Power project contractor', 'Mr. Sunil Bawane'],
  ['C300005', 'Satpuda Housing Corporation', 'Nagpur', '3000', 110, 30, 7, 5, 400, 'Housing developer', 'Ms. Kirti Deshmukh'],
  ['C300006', 'Gondwana Pipes and Structures', 'Gondia', '3000', 80, 30, 12, 6, 300, 'Precast elements', 'Mr. Vinod Meshram']
];

const customers = customerProfiles.map(([id, name, city, companyCode, monthly, terms, late, sd, limitL, segment, contact], i) => ({
  id,
  name,
  city,
  companyCode,
  segment,
  contact,
  paymentTermsDays: terms,
  creditLimit: limitL * L,
  accountManager: pick(['Mr. Rakesh Jain', 'Ms. Shruti Kamat', 'Mr. Deepak Varma']),
  gstin: `27AAB${String.fromCharCode(67 + (i % 20))}${String(4210 + i * 37).padStart(4, '0')}${'ABCDEFGH'[i % 8]}1Z${(i % 9) + 1}`,
  _monthly: monthly * L,
  _late: late,
  _sd: sd
}));

const arItems = [];
let billingNo = 900412000;
for (const c of customers) {
  const perMonth = c._monthly > 300 * L ? 7 : c._monthly > 150 * L ? 5 : 4;
  const gap = 30 / perMonth;
  for (let t = -215; t <= -1; t += Math.max(2, normal(gap, gap * 0.3))) {
    const invoiceDate = day(t);
    const amount = roundTo(Math.max(1.5 * L, normal(c._monthly / perMonth, c._monthly / perMonth / 4)), 1);
    const dueDate = day(t + c.paymentTermsDays);
    const late = Math.max(-6, normal(c._late, c._sd));
    const payOffset = t + c.paymentTermsDays + late;
    const cleared = payOffset < 0;
    billingNo += 1 + Math.floor(rand() * 40);
    arItems.push({
      docNo: String(billingNo),
      customerId: c.id,
      companyCode: c.companyCode,
      invoiceDate,
      dueDate,
      amount,
      openAmount: cleared ? 0 : amount,
      status: cleared ? 'cleared' : 'open',
      clearingDate: cleared ? day(Math.round(payOffset)) : null,
      reference: `INV/${c.companyCode.slice(0, 1)}${String(billingNo).slice(-5)}`,
      disputed: false,
      disputeNote: null
    });
  }
}

// PLANTED: Vidarbha Highways disputes one invoice for short supply. Their oldest open one.
{
  const open = arItems.filter((a) => a.customerId === 'C300001' && a.status === 'open').sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  const target = open[0];
  target.disputed = true;
  target.disputeNote = 'Customer claims 120 MT short-supplied against this invoice. Weighbridge slips requested from the Nagpur plant on 21 Oct.';
}

// PLANTED: Gateway Infra Traders has stopped paying entirely for the last three months.
for (const a of arItems) {
  if (a.customerId === 'C200005' && a.invoiceDate >= day(-120)) {
    a.status = 'open';
    a.openAmount = a.amount;
    a.clearingDate = null;
  }
}

// PLANTED: Harbourline has two older invoices still unpaid, pushing them past their limit.
{
  const old = arItems
    .filter((a) => a.customerId === 'C200002' && a.status === 'cleared' && a.invoiceDate >= day(-150) && a.invoiceDate <= day(-110))
    .slice(0, 2);
  for (const a of old) {
    a.status = 'open';
    a.openAmount = a.amount;
    a.clearingDate = null;
  }
}

// PLANTED: Thane Urban promised on 24 Oct to pay by 31 Oct, and nothing has come in since.
for (const a of arItems) {
  if (a.customerId === 'C200003' && a.status === 'cleared' && a.clearingDate >= day(-16)) {
    a.status = 'open';
    a.openAmount = a.amount;
    a.clearingDate = null;
  }
}

// Partial payments on a handful of items, as happens with retention and TDS deductions.
for (const a of arItems) {
  if (a.status === 'open' && rand() < 0.07 && !a.disputed) {
    a.openAmount = roundTo(a.amount * (0.1 + rand() * 0.3), 1);
    a.partiallyPaid = true;
  }
}

const promises = [
  // PLANTED: a promise that was broken.
  { id: 'PTP-0412', customerId: 'C200003', amount: 45 * L, promisedFor: day(-9), recordedAt: day(-16), recordedBy: people.ar.name, note: 'Mr. Pathak confirmed by phone, cheque to be deposited by 31 Oct.' },
  { id: 'PTP-0418', customerId: 'C200001', amount: 62 * L, promisedFor: day(6), recordedAt: day(-3), recordedBy: people.ar.name, note: 'RTGS scheduled for 15 Nov after their own client releases funds.' },
  { id: 'PTP-0420', customerId: 'C300001', amount: 1.1 * CR, promisedFor: day(11), recordedAt: day(-2), recordedBy: people.ar.name, note: 'Excluding the disputed invoice. NHAI milestone payment expected mid-November.' }
];

const dunningHistory = [
  { customerId: 'C200005', level: 3, sentAt: day(-6), by: people.ar.name, note: 'Final reminder before legal notice.' },
  { customerId: 'C200005', level: 2, sentAt: day(-27), by: people.ar.name, note: '' },
  { customerId: 'C300003', level: 2, sentAt: day(-12), by: people.ar.name, note: '' },
  { customerId: 'C100005', level: 2, sentAt: day(-8), by: people.ar.name, note: '' }
];

// --- Vendors and payables -------------------------------------------------------

// msme: the MSMED Act category. Micro and small enterprises must be paid within 45 days of
// acceptance, or the buyer owes compound interest and loses the tax deduction (43B(h)).
const vendorProfiles = [
  ['V100101', 'Aditya Refractories', 'Bhilai', ['1000', '2000'], 45, 45, 'small', false],
  ['V100102', 'Oman Mining LLC', 'Muscat, Oman', ['1000'], 180, 60, null, true],
  ['V100103', 'Bharat Bearings', 'Rajkot', ['1000', '3000'], 25, 30, 'micro', false],
  ['V100104', 'Vindhya Logistics', 'Raipur', ['2000', '3000'], 70, 30, 'small', false],
  ['V100105', 'Shreeji Minerals', 'Udaipur', ['1000', '3000'], 160, 45, null, false],
  ['V100106', 'Sunfield Packaging', 'Pune', ['1000', '2000', '3000'], 60, 45, 'small', false],
  ['V100107', 'Konkan Conveyors', 'Kolhapur', ['1000', '3000'], 40, 45, 'small', false],
  ['V100108', 'Jebel Coal DMCC', 'Dubai, UAE', ['2000'], 420, 90, null, true],
  ['V100109', 'Saraswati Chemicals', 'Nashik', ['1000'], 18, 30, 'micro', false],
  ['V100110', 'Western Grid Power Distribution Ltd.', 'Mumbai', ['1000', '2000', '3000'], 380, 15, null, false],
  ['V100111', 'Swift Freight Carriers', 'Nagpur', ['3000'], 55, 15, 'micro', false],
  ['V100112', 'Apex Facility Services', 'Mumbai', ['2000'], 22, 30, null, false],
  ['V100113', 'Nexa IT Solutions Pvt. Ltd.', 'Pune', ['1000'], 30, 30, null, false],
  ['V100114', 'Deccan Engineering Works', 'Pune', ['1000'], 35, 30, 'small', false]
];

const vendors = vendorProfiles.map(([id, name, city, codes, monthlyL, terms, msme, foreign], i) => ({
  id,
  name,
  city,
  companyCodes: codes,
  paymentTermsDays: terms,
  msmeCategory: msme,
  foreign,
  currency: foreign ? 'USD' : 'INR',
  gstin: foreign ? null : `${['27', '24', '22', '08'][i % 4]}AAC${String.fromCharCode(70 + (i % 15))}${String(5300 + i * 53).padStart(4, '0')}${'KLMNPQRS'[i % 8]}1Z${(i % 9) + 1}`,
  bankAccountLast4: String(1000 + Math.floor(rand() * 8999)),
  bankLastChangedAt: day(-200 - Math.floor(rand() * 400)),
  bankChangedBy: null,
  discountTerms: null,
  contact: pick(['Accounts desk', 'Receivables team', 'Finance office']),
  _monthly: monthlyL * L
}));

// PLANTED: Swift Freight's bank account was changed three days ago, by email request.
{
  const v = vendors.find((x) => x.id === 'V100111');
  v.bankLastChangedAt = day(-3);
  v.bankChangedBy = `${people.acc1.name}, on an emailed request`;
  v.previousBankAccountLast4 = v.bankAccountLast4;
  v.bankAccountLast4 = '7731';
}
// Shreeji offers 2% off for payment within ten days.
vendors.find((x) => x.id === 'V100105').discountTerms = { percent: 2, withinDays: 10 };

// How late each unit pays, in days after due. Nagpur stretches its vendors.
const apLag = { 1000: [1, 2], 2000: [2, 3], 3000: [8, 4] };

const apItems = [];
let invNo = 5105612000;
let poNo = 4500179000;
for (const v of vendors) {
  const perMonth = v._monthly > 200 * L ? 4 : 3;
  const gap = 30 / perMonth;
  for (let t = -130; t <= -1; t += Math.max(3, normal(gap, gap * 0.3))) {
    const companyCode = pick(v.companyCodes);
    const gross = roundTo(Math.max(0.6 * L, normal(v._monthly / perMonth, v._monthly / perMonth / 5)), 1);
    const invoiceDate = day(t - 2);
    const postingDate = day(t);
    const dueDate = day(t + v.paymentTermsDays);
    const [lagMean, lagSd] = apLag[companyCode];
    const payOffset = t + v.paymentTermsDays + Math.max(-2, normal(v.msmeCategory ? Math.min(lagMean, 3) : lagMean, lagSd));
    const paid = payOffset < 0;
    invNo += 1 + Math.floor(rand() * 25);
    poNo += 1 + Math.floor(rand() * 12);
    const tds = v.foreign ? 0 : roundTo(gross * (v.id === 'V100110' ? 0 : 0.02) / 1.18, 1);
    apItems.push({
      docNo: String(invNo),
      vendorId: v.id,
      companyCode,
      vendorReference: `${v.name.split(' ')[0].slice(0, 3).toUpperCase()}/${String(invNo).slice(-4)}/26-27`,
      poNumber: v.id === 'V100110' ? null : String(poNo),
      invoiceDate,
      postingDate,
      dueDate,
      gross,
      tds,
      net: gross - tds,
      status: paid ? 'paid' : 'open',
      clearingDate: paid ? day(Math.round(payOffset)) : null,
      blockReason: null,
      variance: null
    });
  }
}

function openFor(vendorId, filter = () => true) {
  return apItems.filter((a) => a.vendorId === vendorId && a.status === 'open' && filter(a));
}

// PLANTED: an MSME invoice from Konkan Conveyors accepted 52 days ago and still unpaid.
{
  invNo += 7;
  apItems.push({
    docNo: String(invNo),
    vendorId: 'V100107',
    companyCode: '3000',
    vendorReference: 'KON/2231/26-27',
    poNumber: '4500178512',
    invoiceDate: day(-54),
    postingDate: day(-52),
    dueDate: day(-7),
    gross: 12.9 * L,
    tds: roundTo((12.9 * L * 0.02) / 1.18, 1),
    net: 12.9 * L - roundTo((12.9 * L * 0.02) / 1.18, 1),
    status: 'open',
    clearingDate: null,
    blockReason: null,
    variance: null
  });
}
// PLANTED: a Vindhya Logistics invoice at 47 days, unpaid because the Mumbai run skipped it.
{
  invNo += 5;
  apItems.push({
    docNo: String(invNo),
    vendorId: 'V100104',
    companyCode: '2000',
    vendorReference: 'VIN/0874/26-27',
    poNumber: '4500178266',
    invoiceDate: day(-49),
    postingDate: day(-47),
    dueDate: day(-17),
    gross: 18.8 * L,
    tds: roundTo((18.8 * L * 0.02) / 1.18, 1),
    net: 18.8 * L - roundTo((18.8 * L * 0.02) / 1.18, 1),
    status: 'open',
    clearingDate: null,
    blockReason: null,
    variance: null
  });
}

// PLANTED: a duplicate. The same Bharat Bearings invoice entered twice, two days apart, with
// the reference typed slightly differently each time so the standard duplicate check
// (which compares the reference exactly) let it through.
const dupAmount = 486750;
for (const [offset, ref] of [[-6, 'BB/2231/26-27'], [-4, 'BB-2231/26-27']]) {
  invNo += 3;
  apItems.push({
    docNo: String(invNo),
    vendorId: 'V100103',
    companyCode: '1000',
    vendorReference: ref,
    poNumber: '4500178455',
    invoiceDate: day(-9),
    postingDate: day(offset),
    dueDate: day(-9 + 30),
    gross: dupAmount,
    tds: roundTo((dupAmount * 0.02) / 1.18, 1),
    net: dupAmount - roundTo((dupAmount * 0.02) / 1.18, 1),
    status: 'open',
    clearingDate: null,
    blockReason: null,
    variance: null
  });
}

// Shreeji's latest invoice, inside its discount window, not in any run yet.
{
  invNo += 4;
  const gross = 96.4 * L;
  apItems.push({
    docNo: String(invNo),
    vendorId: 'V100105',
    companyCode: '1000',
    vendorReference: 'SHR/1186/26-27',
    poNumber: '4500178530',
    invoiceDate: day(-7),
    postingDate: day(-7),
    dueDate: day(38),
    discountDate: day(3),
    gross,
    tds: roundTo((gross * 0.02) / 1.18, 1),
    net: gross - roundTo((gross * 0.02) / 1.18, 1),
    status: 'open',
    clearingDate: null,
    blockReason: null,
    variance: null
  });
}

// Blocked invoices: held by the three-way match or by hand, waiting for somebody to release.
const blocks = [
  {
    vendorId: 'V100108', companyCode: '2000', ref: 'JCD/INV/7781', po: '4500178498', daysAgo: 6, terms: 90,
    reason: 'Price variance',
    variance: { kind: 'price', poPrice: 8850, invoicePrice: 9120, unit: 'MT', quantity: 4500, tolerancePercent: 2, currency: 'INR equivalent' },
    preparedBy: people.ap
  },
  {
    vendorId: 'V100105', companyCode: '3000', ref: 'SHR/1172/26-27', po: '4500178531', daysAgo: 4, terms: 45,
    reason: 'Quantity variance',
    variance: { kind: 'quantity', poPrice: 2140, invoicePrice: 2140, unit: 'MT', invoicedQuantity: 4800, receivedQuantity: 4650, tolerancePercent: 1 },
    preparedBy: people.ap
  },
  {
    vendorId: 'V100107', companyCode: '1000', ref: 'KON/2240/26-27', po: '4500178540', daysAgo: 9, terms: 45,
    reason: 'Goods receipt missing',
    variance: { kind: 'receipt', amountWithoutReceipt: 7.4 * L, note: 'Service entry sheet for belt splicing at the Pune clinker line has not been created. The work was completed on 28 Oct per the plant maintenance log.' },
    gross: 7.4 * L,
    preparedBy: people.ap
  },
  {
    vendorId: 'V100101', companyCode: '2000', ref: 'ADR/0932/26-27', po: '4500178401', daysAgo: 12, terms: 45,
    reason: 'Blocked by hand',
    variance: { kind: 'manual', note: 'Blocked by the Mumbai plant: 14 of 80 MT of refractory bricks failed the cold crushing strength test. Vendor has agreed to replace them; plant says the invoice can be paid once replacements arrive.' },
    gross: 1.19 * CR,
    preparedBy: people.acc2
  },
  {
    vendorId: 'V100102', companyCode: '1000', ref: 'OML/26/4471', po: '4500178342', daysAgo: 3, terms: 60,
    reason: 'Price variance',
    variance: { kind: 'price', poPrice: 8820, invoicePrice: 8932, unit: 'MT', quantity: 560, tolerancePercent: 1, note: 'Difference matches the USD/INR rate moving from 83.10 to 84.15 between order and invoice.' },
    preparedBy: people.ap
  },
  {
    vendorId: 'V100106', companyCode: '3000', ref: 'SFP/3310/26-27', po: '4500178560', daysAgo: 5, terms: 45,
    reason: 'Quantity variance',
    variance: { kind: 'quantity', poPrice: 18.5, invoicePrice: 18.5, unit: 'bags', invoicedQuantity: 120000, receivedQuantity: 120000, tolerancePercent: 1, note: 'Second receipt of 20,000 bags was posted to the Mumbai plant by mistake and reversed on 6 Nov. The invoice now matches.' },
    preparedBy: people.ap
  }
];

const blockedInvoices = [];
for (const b of blocks) {
  invNo += 6;
  let gross = b.gross;
  if (!gross && b.variance.kind === 'price') gross = Math.round(b.variance.invoicePrice * b.variance.quantity * 1.05);
  if (!gross && b.variance.kind === 'quantity') gross = Math.round(b.variance.invoicePrice * b.variance.invoicedQuantity * 1.05);
  const item = {
    docNo: String(invNo),
    vendorId: b.vendorId,
    companyCode: b.companyCode,
    vendorReference: b.ref,
    poNumber: b.po,
    invoiceDate: day(-b.daysAgo - 2),
    postingDate: day(-b.daysAgo),
    dueDate: day(-b.daysAgo + b.terms),
    gross,
    tds: vendors.find((v) => v.id === b.vendorId).foreign ? 0 : roundTo((gross * 0.02) / 1.18, 1),
    status: 'blocked',
    clearingDate: null,
    blockReason: b.reason,
    variance: b.variance,
    blockedBy: b.preparedBy.name,
    blockedAt: `${weekday(-b.daysAgo)}T${String(9 + Math.floor(rand() * 8)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00`
  };
  item.net = item.gross - item.tds;
  apItems.push(item);
  blockedInvoices.push(item.docNo);
}

// --- Banks ----------------------------------------------------------------------

const bankAccounts = [
  { id: 'HDFC-4521', companyCode: '1000', bank: 'HDFC Bank', branch: 'Pune, FC Road', type: 'Current account', last4: '4521', balance: 14.6 * CR, limit: 0, statementDate: day(0) },
  { id: 'ICICI-0087', companyCode: '1000', bank: 'ICICI Bank', branch: 'Pune, Baner', type: 'Current account', last4: '0087', balance: 3.2 * CR, limit: 0, statementDate: day(0) },
  { id: 'HDFC-7710', companyCode: '2000', bank: 'HDFC Bank', branch: 'Mumbai, Fort', type: 'Current account', last4: '7710', balance: 9.8 * CR, limit: 0, statementDate: day(0) },
  { id: 'AXIS-3302', companyCode: '2000', bank: 'Axis Bank', branch: 'Mumbai, BKC', type: 'Current account', last4: '3302', balance: 1.4 * CR, limit: 0, statementDate: day(0) },
  { id: 'SBI-6618', companyCode: '3000', bank: 'State Bank of India', branch: 'Nagpur, Sitabuldi', type: 'Current account', last4: '6618', balance: 1.85 * CR, limit: 0, statementDate: day(-1) },
  { id: 'SBI-9001', companyCode: '3000', bank: 'State Bank of India', branch: 'Nagpur, Sitabuldi', type: 'Cash credit', last4: '9001', balance: -9.35 * CR, limit: 10 * CR, statementDate: day(-1) }
];

// Money that leaves every month regardless of invoices: salaries, statutory dues, rent.
const recurringOutflows = [
  { id: 'SAL', label: 'Salaries', dayOfMonth: 1, amounts: { 1000: 1.45 * CR, 2000: 1.1 * CR, 3000: 0.92 * CR } },
  { id: 'TDS', label: 'TDS deposit', dayOfMonth: 7, amounts: { 1000: 0.31 * CR, 2000: 0.27 * CR, 3000: 0.19 * CR } },
  { id: 'PF', label: 'PF and ESIC', dayOfMonth: 15, amounts: { 1000: 0.22 * CR, 2000: 0.17 * CR, 3000: 0.14 * CR } },
  { id: 'GST', label: 'GST payment (GSTR-3B)', dayOfMonth: 20, amounts: { 1000: 1.9 * CR, 2000: 2.4 * CR, 3000: 1.55 * CR } },
  { id: 'EMI', label: 'Term loan instalment', dayOfMonth: 5, amounts: { 1000: 0.85 * CR, 2000: 0, 3000: 0.4 * CR } }
];

// --- Payment runs ---------------------------------------------------------------

// What each unit's AP lead proposed for the run on 10 Nov: everything open, not blocked,
// due within the week, plus anything already overdue.
const runDate = day(1);
function proposalFor(companyCode, extraFilter = () => true) {
  return apItems
    .filter((a) => a.companyCode === companyCode && a.status === 'open' && a.dueDate <= day(14) && extraFilter(a))
    .map((a) => a.docNo);
}

const paymentRuns = [
  {
    id: 'F110-1000-1011',
    runId: 'PUN1',
    companyCode: '1000',
    runDate,
    bankAccountId: 'HDFC-4521',
    preparedBy: people.ap,
    preparedAt: `${day(0)}T10:42:00`,
    // Includes BOTH of the duplicate Bharat Bearings invoices? No - one is due in 21 days,
    // so the second copy is included by an "include all for vendor" setting. PLANTED.
    items: [...new Set([...proposalFor('1000'), ...apItems.filter((a) => a.vendorId === 'V100103' && a.gross === dupAmount).map((a) => a.docNo)])]
  },
  {
    id: 'F110-2000-1011',
    runId: 'MUM1',
    companyCode: '2000',
    runDate,
    bankAccountId: 'HDFC-7710',
    preparedBy: people.ap,
    preparedAt: `${day(0)}T11:05:00`,
    // PLANTED: the overdue Vindhya MSME invoice is left out of this run.
    items: proposalFor('2000', (a) => a.vendorReference !== 'VIN/0874/26-27')
  },
  {
    id: 'F110-3000-1011',
    runId: 'NAG1',
    companyCode: '3000',
    runDate,
    bankAccountId: 'SBI-6618',
    preparedBy: people.acc1,
    preparedAt: `${day(0)}T12:18:00`,
    // PLANTED: includes Swift Freight, whose bank account changed three days ago.
    items: proposalFor('3000')
  }
];

// --- Journal entries waiting to be posted -----------------------------------------

function line(gl, side, amount, costCentre = null, text = '') {
  return { gl, debit: side === 'D' ? amount : 0, credit: side === 'C' ? amount : 0, costCentre, text };
}

const journalEntries = [
  {
    docNo: '100000412', companyCode: '1000', type: 'Accrual', period: 7,
    title: 'October power accrual, Pune',
    description: 'Power and fuel for October at the Pune plant. The utility bill arrives around the 12th; the accrual uses metered units of 2.38 million kWh at the contracted rate of 7.72 per kWh.',
    preparedBy: people.gl, preparedAt: `${day(-3)}T16:20:00`, attachments: 2, reversal: 'Reverses on 1 Nov 2026',
    lines: [line('520000', 'D', 1.84 * CR, '1000-PRD', 'Power, October'), line('220100', 'C', 1.84 * CR, null, 'Accrued power')]
  },
  {
    docNo: '100000413', companyCode: '2000', type: 'Provision', period: 7,
    title: 'Bonus provision, October',
    description: 'Monthly provision for statutory bonus at 8.33 percent of eligible wages, Mumbai unit.',
    preparedBy: people.gl, preparedAt: `${day(-3)}T11:05:00`, attachments: 1, reversal: null,
    lines: [line('550500', 'D', 62 * L, '2000-ADM', 'Bonus provision'), line('220200', 'C', 62 * L, null, 'Provision for bonus')]
  },
  {
    docNo: '100000414', companyCode: '3000', type: 'Reclassification', period: 7,
    title: 'Clear freight out of suspense',
    description: 'Freight bills posted to suspense in September because the cost centre was not given. Reclassifying to freight outward, Nagpur logistics.',
    preparedBy: people.acc1, preparedAt: `${day(-4)}T15:40:00`, attachments: 3, reversal: null,
    lines: [line('530000', 'D', 18.4 * L, '3000-LOG', 'Freight, Sep and Oct'), line('199999', 'C', 18.4 * L, null, 'Suspense cleared')]
  },
  {
    docNo: '100000415', companyCode: '2000', type: 'Write-off', period: 7,
    title: 'Write off Gateway Infra Traders short payment',
    description: 'Gateway deducted a cash discount they were not entitled to on three invoices in June. Recovery judged uneconomic by the Mumbai sales head.',
    preparedBy: people.ar, preparedAt: `${day(-5)}T10:12:00`, attachments: 1, reversal: null,
    lines: [line('590000', 'D', 9.6 * L, '2000-SAL', 'Unrecoverable deduction'), line('140000', 'C', 9.6 * L, null, 'Gateway Infra Traders, C200005')],
    // Write-offs need the CFO as well, whatever the amount.
    needsCfo: true
  },
  {
    docNo: '100000416', companyCode: '1000', type: 'Amortisation', period: 7,
    title: 'Insurance amortisation, October',
    description: 'One twelfth of the annual industrial all-risk policy, premium 86.4 lakh paid in April.',
    preparedBy: people.gl, preparedAt: `${day(-3)}T12:30:00`, attachments: 1, reversal: null,
    lines: [line('570000', 'D', 7.2 * L, '1000-ADM', 'Insurance, October'), line('150100', 'C', 7.2 * L, null, 'Prepaid insurance')]
  },
  {
    docNo: '100000417', companyCode: '2000', type: 'Revaluation', period: 7,
    title: 'Foreign currency revaluation, Jebel Coal payable',
    description: 'Month-end revaluation of USD 2.21 million owed to Jebel Coal DMCC. Rate moved from 83.10 to 84.15.',
    preparedBy: people.treasury, preparedAt: `${day(-3)}T17:45:00`, attachments: 1, reversal: 'Reverses on 1 Nov 2026',
    lines: [line('595000', 'D', 23.1 * L, '2000-ADM', 'Unrealised exchange loss'), line('210000', 'C', 23.1 * L, null, 'Jebel Coal DMCC, V100108')]
  },
  {
    docNo: '100000418', companyCode: '1000', type: 'Intercompany', period: 7,
    title: 'Recharge shared IT costs to Mumbai and Nagpur',
    description: 'SAP licences, network and helpdesk run from Pune, recharged by headcount: Mumbai 38 percent, Nagpur 27 percent.',
    preparedBy: people.co, preparedAt: `${day(-3)}T14:10:00`, attachments: 2, reversal: null,
    lines: [line('170100', 'D', 34 * L, null, 'Due from Mumbai and Nagpur'), line('560000', 'C', 34 * L, '1000-IT', 'IT recharge')]
  },
  {
    // PLANTED: posted late on a Sunday night, to an expense account, with no attachment.
    docNo: '100000419', companyCode: '3000', type: 'Manual entry', period: 7,
    title: 'Depreciation correction, kiln 2',
    description: 'Correction to depreciation on kiln 2 after the useful life was revised.',
    preparedBy: people.acc1, preparedAt: `${day(-1)}T23:41:00`, attachments: 0, reversal: null,
    lines: [line('180100', 'D', 4.1 * L, null, 'Accumulated depreciation'), line('580000', 'C', 4.1 * L, '3000-PRD', 'Depreciation reversed')]
  },
  {
    docNo: '100000420', companyCode: '1000', type: 'Accrual', period: 7,
    title: 'Freight accrual, October dispatches',
    description: 'Outbound freight for October dispatches where the transporter bill has not arrived: 41,200 MT at an average 168 per MT.',
    preparedBy: people.gl, preparedAt: `${day(0)}T09:55:00`, attachments: 1, reversal: 'Reverses on 1 Nov 2026',
    lines: [line('530000', 'D', 69.2 * L, '1000-LOG', 'Freight, October'), line('220100', 'C', 69.2 * L, null, 'Accrued freight')]
  }
].map((je) => ({ ...je, amount: je.lines.reduce((s, l) => s + l.debit, 0) }));

// --- Cost centres and budgets ---------------------------------------------------

// annual plan in lakh; drift = how actuals run against plan (1.18 = 18 percent over).
const costCentreProfiles = [
  ['1000-PRD', 'Production', '1000', 'Mr. Sameer Apte', 4200, 1.03],
  ['1000-MNT', 'Maintenance', '1000', 'Mr. Yogesh Kadam', 860, 0.97],
  ['1000-LOG', 'Logistics', '1000', 'Ms. Anjali Rane', 1150, 1.06],
  ['1000-SAL', 'Sales and marketing', '1000', 'Mr. Rakesh Jain', 420, 0.78],
  ['1000-ADM', 'Administration and HR', '1000', 'Ms. Swati Lele', 380, 1.01],
  ['1000-IT', 'IT and shared services', '1000', 'Mr. Kunal Bapat', 540, 1.09],
  ['2000-PRD', 'Production', '2000', 'Mr. Dinesh Iyer', 5100, 1.02],
  ['2000-MNT', 'Maintenance', '2000', 'Mr. Joseph Dsouza', 940, 1.04],
  ['2000-LOG', 'Logistics', '2000', 'Mr. Harish Shetty', 1480, 1.18],
  ['2000-SAL', 'Sales and marketing', '2000', 'Ms. Shruti Kamat', 510, 0.95],
  ['2000-ADM', 'Administration and HR', '2000', 'Mr. Aniket Rao', 420, 0.98],
  ['3000-PRD', 'Production', '3000', 'Mr. Pravin Gawande', 3600, 0.99],
  ['3000-MNT', 'Maintenance', '3000', 'Mr. Nilesh Bhagat', 780, 1.13],
  ['3000-LOG', 'Logistics', '3000', 'Mr. Amol Thakare', 990, 1.05],
  ['3000-ADM', 'Administration and HR', '3000', 'Ms. Rupali Borkar', 310, 1.0]
];

// Cement sells less in the monsoon (Jun to Sep) and more after it.
const season = [1.02, 1.04, 0.9, 0.84, 0.86, 0.92, 1.04, 1.08, 1.06, 1.05, 1.03, 1.06];
const seasonSum = season.reduce((a, b) => a + b, 0);

const costCentres = costCentreProfiles.map(([id, name, companyCode, owner, annualL, drift]) => {
  const annual = annualL * L;
  const plan = season.map((s) => roundTo((annual * s) / seasonSum, 1000));
  const actual = plan.slice(0, fiscal.closingPeriod).map((p, i) => {
    // Overruns build up through the year rather than appearing at once.
    const ramp = 1 + (drift - 1) * (0.55 + (i / fiscal.closingPeriod) * 0.9);
    return roundTo(p * ramp * normal(1, 0.025), 1000);
  });
  return {
    id,
    name,
    companyCode,
    owner,
    annualPlan: plan.reduce((a, b) => a + b, 0),
    monthlyPlan: plan,
    monthlyActual: actual,
    committed: roundTo(annual * (0.02 + rand() * 0.04), 1000)
  };
});

// --- Month-end close, October ------------------------------------------------------

// Working day calendar for the October close. WD1 is the first working day of November.
const wd = { '-2': day(-11), '-1': day(-10), 1: day(-7), 2: day(-6), 3: day(-5), 4: day(-4), 5: day(-3), 6: day(0), 7: day(1), 8: day(2) };
const closeTasks = [];
let taskNo = 1;
function task(area, title, tcode, owner, wdKey, status, companyCode, note = '', extra = {}) {
  closeTasks.push({
    id: `CL-${String(taskNo++).padStart(3, '0')}`,
    area,
    title,
    tcode,
    owner: owner.name,
    ownerTitle: owner.title,
    workingDay: Number(wdKey),
    dueDate: wd[wdKey],
    status,
    companyCode,
    note,
    completedAt: status === 'done' ? (extra.completedAt || `${wd[wdKey]}T${String(10 + (taskNo % 7)).padStart(2, '0')}:15:00`) : null,
    ...extra
  });
}

for (const cc of ['1000', '2000', '3000']) {
  const acc = cc === '3000' ? people.acc1 : cc === '2000' ? people.acc2 : people.gl;
  task('AP', 'Post all supplier invoices received up to 31 Oct', 'MIRO / FB60', people.ap, -1, 'done', cc);
  task('AR', 'Post all October billing documents to accounting', 'VF04 / VFX3', people.ar, -1, 'done', cc);
  task('Assets', 'Run depreciation for October', 'AFAB', acc, 1, 'done', cc);
  task('GL', 'Open November, close October for AP and AR', 'OB52', people.gl, 1, 'done', cc);
  task('Treasury', 'Bank reconciliation, all accounts', 'FEBAN / FF67', people.treasury, 2,
    cc === '3000' ? 'blocked' : 'done', cc,
    cc === '3000' ? 'SBI has not sent the October statement for the cash credit account (****9001). Requested twice; branch says by 10 Nov.' : '');
  task('GL', 'Post month-end accruals', 'FBS1', people.gl, 3,
    cc === '1000' ? 'waiting' : 'done', cc,
    cc === '1000' ? 'Two accruals are posted as parked documents and are waiting for your approval.' : '',
    cc === '1000' ? { waitingOn: ['100000412', '100000420'] } : {});
  task('AP', 'Analyse and clear GR/IR account', 'MR11 / F.13', people.ap, 3,
    cc === '2000' ? 'in progress' : 'done', cc,
    cc === '2000' ? 'Nineteen of 31 items cleared. The rest need buyers to confirm whether goods are still to come.' : '');
  task('Treasury', 'Revalue foreign currency balances', 'FAGL_FCV', people.treasury, 4,
    cc === '2000' ? 'waiting' : 'done', cc,
    cc === '2000' ? 'The revaluation entry for Jebel Coal is parked and waiting for your approval.' : '',
    cc === '2000' ? { waitingOn: ['100000417'] } : {});
  task('Tax', 'Reconcile GST input credit with GSTR-2B', 'J1IG / GSTR-2B', people.tax, 4,
    cc === '3000' ? 'in progress' : 'done', cc,
    cc === '3000' ? 'Input credit of 6.8 lakh from two vendors is not showing in GSTR-2B yet.' : '');
  task('GL', 'Intercompany reconciliation', 'FBICR', people.gl, 5,
    cc === '1000' ? 'waiting' : 'in progress', cc,
    cc === '1000' ? 'Waiting for the IT recharge entry, which is parked for your approval.' : 'Matching against the Pune recharge once it is posted.',
    cc === '1000' ? { waitingOn: ['100000418'] } : {});
  task('CO', 'Run cost centre assessments and distributions', 'KSU5 / KSV5', people.co, 5,
    cc === '3000' ? 'not started' : 'in progress', cc,
    cc === '3000' ? 'Cannot start until the freight reclassification out of suspense is posted.' : '',
    cc === '3000' ? { waitingOn: ['100000414'] } : {});
  task('CO', 'Settle internal orders and production orders', 'KO88 / CO88', people.co, 6, 'not started', cc);
  task('GL', 'Review trial balance and flux against September', 'F.01 / FAGLB03', people.gl, 7, 'not started', cc);
  task('Reporting', 'Publish October management pack', 'SAC', people.co, 8, 'not started', cc);
}

// A few that are done early, to show the calendar is not uniform.
closeTasks.find((t) => t.companyCode === '2000' && t.tcode === 'FBICR').note = 'Mumbai side matched; waiting on the Pune recharge.';

// --- GR/IR -------------------------------------------------------------------------

const grir = [];
for (let i = 0; i < 24; i += 1) {
  const v = pick(vendors.filter((x) => x.id !== 'V100110'));
  const age = i < 5 ? 95 + Math.floor(rand() * 120) : 5 + Math.floor(rand() * 80);
  const grValue = roundTo(normal(v._monthly / 4, v._monthly / 12), 100);
  const kind = rand() < 0.5 ? 'received, not invoiced' : 'invoiced, not received';
  grir.push({
    poNumber: String(4500170000 + Math.floor(rand() * 9000)),
    vendorId: v.id,
    companyCode: pick(v.companyCodes),
    kind,
    lastMovement: day(-age),
    ageDays: age,
    grValue: kind === 'received, not invoiced' ? grValue : 0,
    irValue: kind === 'invoiced, not received' ? grValue : 0,
    buyer: pick(['Mr. Anil Deshmukh', 'Ms. Kavya Raghavan', 'Mr. Sunil Bose'])
  });
}

// --- Older, long-paid customer invoices ----------------------------------------------
//
// Generated last, from the same seed, so adding them did not change any of the numbers
// above. Without them the year's first months would show billing with almost no collections,
// because the invoices those collections paid would not exist.
for (const c of customers) {
  const perMonth = c._monthly > 300 * L ? 7 : c._monthly > 150 * L ? 5 : 4;
  const gap = 30 / perMonth;
  for (let t = -330; t <= -216; t += Math.max(2, normal(gap, gap * 0.3))) {
    const amount = roundTo(Math.max(1.5 * L, normal(c._monthly / perMonth, c._monthly / perMonth / 4)), 1);
    const late = Math.max(-6, normal(c._late, c._sd));
    const payOffset = Math.min(-1, Math.round(t + c.paymentTermsDays + late));
    const docNo = String(880000000 + arItems.length * 7 + Math.floor(rand() * 5));
    arItems.push({
      docNo,
      customerId: c.id,
      companyCode: c.companyCode,
      invoiceDate: day(t),
      dueDate: day(t + c.paymentTermsDays),
      amount,
      openAmount: 0,
      status: 'cleared',
      clearingDate: day(payOffset),
      reference: `INV/${c.companyCode.slice(0, 1)}${docNo.slice(-5)}`,
      disputed: false,
      disputeNote: null
    });
  }
}

// --- Write it all out --------------------------------------------------------------

for (const c of customers) {
  delete c._monthly;
  delete c._late;
  delete c._sd;
}
for (const v of vendors) delete v._monthly;

write('meta.json', {
  _note: 'Sample data. Invented for demonstration; nothing here comes from SAP.',
  asOf: AS_OF,
  generatedBy: 'server/scripts/build-sample-data.js',
  fiscal,
  companyCodes,
  people,
  glAccounts
});
write('customers.json', customers);
write('ar-items.json', arItems);
write('promises.json', promises);
write('dunning-history.json', dunningHistory);
write('vendors.json', vendors);
write('ap-items.json', apItems);
write('payment-runs.json', paymentRuns);
write('journal-entries.json', journalEntries);
write('bank-accounts.json', bankAccounts);
write('recurring-outflows.json', recurringOutflows);
write('cost-centres.json', costCentres);
write('close-tasks.json', closeTasks);
write('grir.json', grir);

// --- A summary, so tuning the profiles is quick ------------------------------------

const crore = (n) => `${(n / CR).toFixed(2)} cr`;
const openAR = arItems.filter((a) => a.status === 'open');
const openAP = apItems.filter((a) => a.status !== 'paid');
console.log(`AR items ${arItems.length}, open ${openAR.length}, open value ${crore(openAR.reduce((s, a) => s + a.openAmount, 0))}`);
for (const cc of companyCodes) {
  const mine = openAR.filter((a) => a.companyCode === cc.code);
  const ap = openAP.filter((a) => a.companyCode === cc.code);
  console.log(`  ${cc.code} ${cc.name}: AR ${crore(mine.reduce((s, a) => s + a.openAmount, 0))}, AP ${crore(ap.reduce((s, a) => s + a.gross, 0))}`);
}
for (const c of customers) {
  const exp = openAR.filter((a) => a.customerId === c.id).reduce((s, a) => s + a.openAmount, 0);
  const overdue = openAR.filter((a) => a.customerId === c.id && a.dueDate < AS_OF).reduce((s, a) => s + a.openAmount, 0);
  console.log(`    ${c.name.padEnd(36)} exposure ${crore(exp).padStart(9)} limit ${crore(c.creditLimit).padStart(9)} overdue ${crore(overdue)}`);
}
for (const r of paymentRuns) {
  const total = r.items.reduce((s, d) => s + apItems.find((a) => a.docNo === d).net, 0);
  console.log(`  run ${r.id}: ${r.items.length} items, ${crore(total)}`);
}
console.log(`AP items ${apItems.length}, open/blocked ${openAP.length}; JEs ${journalEntries.length}; close tasks ${closeTasks.length}; GR/IR ${grir.length}`);
console.log(`Wrote to ${OUT}`);
