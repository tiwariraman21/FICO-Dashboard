// Payables: what falls due, what is blocked, which MSME invoices are close to (or past) the
// 45-day limit, and which suppliers need a second look before they are paid.

import { useState } from 'react';
import { inr, dmy, plural } from '../format.js';
import { Card, Chip, Icon, Tile, Banner } from '../components/ui.jsx';
import { payablesFor, sum } from '../selectors.js';

const VIEWS = [
  { key: 'all', label: 'All open', test: () => true },
  { key: 'overdue', label: 'Overdue', test: (i) => i.status === 'open' && i.overdue },
  { key: 'week', label: 'Due in 7 days', test: (i) => i.status === 'open' && !i.overdue && i.dueIn <= 7 },
  { key: 'blocked', label: 'Blocked', test: (i) => i.status === 'blocked' },
  { key: 'run', label: 'In a payment run', test: (i) => Boolean(i.inRun) },
  { key: 'msme', label: 'MSME', test: (i) => i.msme }
];

export default function Payables({ data, unit, onOpenDocument }) {
  const ap = payablesFor(data, unit);
  const [view, setView] = useState('all');
  // Supplier totals worked out from this unit's invoices, so the filter applies here too.
  const vendors = data.payables.vendors
    .map((v) => {
      const mine = ap.items.filter((i) => i.vendorId === v.id);
      const open = mine.filter((i) => i.status === 'open');
      return {
        ...v,
        openCount: mine.length,
        open: sum(mine, 'gross'),
        overdue: sum(open.filter((i) => i.overdue), 'gross'),
        inRun: sum(mine.filter((i) => i.inRun), 'net'),
        blocked: sum(mine.filter((i) => i.status === 'blocked'), 'gross'),
        msmeBreaches: mine.filter((i) => i.msmeBreached).length
      };
    })
    .sort((a, b) => b.open - a.open);
  const items = ap.items.filter(VIEWS.find((v) => v.key === view).test);
  const msme = ap.items.filter((i) => i.msme).sort((a, b) => a.msmeDaysLeft - b.msmeDaysLeft).slice(0, 8);
  const bankChanged = data.payables.vendors.filter((v) => v.bankChangedRecently);

  return (
    <>
      {bankChanged.length > 0 && (
        <Banner kind="err" icon="alert">
          <b>Bank details changed recently:</b>{' '}
          {bankChanged.map((v) => `${v.name}, ${plural(v.bankChangedDaysAgo, 'day')} ago (${v.bankChangedBy})`).join('; ')}. Confirm by phone, on a number already on file, before paying.
        </Banner>
      )}

      <div className="tiles">
        <Tile icon="down" label="Open payables" value={inr(ap.total)} sub={plural(ap.items.length, 'invoice')} tone="pri" footer={`DPO ${ap.dpo ?? '–'} days`} />
        <Tile icon="clock" label="Overdue" value={inr(ap.overdue)} sub="past the due date" tone={ap.overdue ? 'warn' : 'pos'} footer={`${plural(ap.items.filter((i) => i.status === 'open' && i.overdue).length, 'invoice')}, ${plural(ap.items.filter((i) => i.status === 'open' && i.overdue && !i.inRun).length, 'not in a run', 'not in a run')}`} />
        <Tile icon="send" label="Due in the next 7 days" value={inr(ap.dueWeek)} sub="not yet overdue" tone="mut" footer="most are in tomorrow's runs" />
        <Tile icon="shield" label="Blocked for payment" value={ap.blocked.length} sub={inr(sum(ap.blocked, 'gross'))} tone={ap.blocked.length ? 'warn' : 'pos'} footer="release from the approval queue" />
        <Tile icon="alert" label="MSME past 45 days" value={ap.msmeBreached.length} sub={ap.msmeAtRisk.length ? `${ap.msmeAtRisk.length} more within 10 days` : 'none close to the limit'} tone={ap.msmeBreached.length ? 'neg' : 'pos'} footer="MSMED Act, section 15" />
        <Tile icon="spark" label="Discounts available" value={inr(sum(ap.discounts, (i) => i.discount.amount))} sub={ap.discounts.length ? `pay by ${dmy(ap.discounts[0].discount.by, false)}` : 'none open'} tone={ap.discounts.length ? 'warn' : 'mut'} footer={ap.discounts.length ? `${plural(ap.discounts.length, 'invoice')}, not in a run` : '–'} />
      </div>

      <div className="grid" style={{ marginBottom: 13 }}>
        <Card span="c6" icon="alert" tone={ap.msmeBreached.length ? 'neg' : 'warn'} title="MSME invoices, closest to the 45-day limit" subtitle="micro and small enterprises must be paid within 45 days of acceptance" flush>
          {msme.length === 0 ? <p className="muted rowpad">No MSME invoices open.</p> : msme.map((i) => (
            <div className="row" key={i.docNo}>
              <span className={`prio bg-${i.msmeBreached ? 'neg' : i.msmeDaysLeft <= 10 ? 'warn' : 'mut'}`}>{i.msmeBreached ? '!' : i.msmeDaysLeft}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="t1">{i.vendorName}, {i.vendorReference}</span>
                <span className="t2">
                  {i.msmeBreached ? `${i.daysSincePosting} days since acceptance, ${i.daysSincePosting - 45} past the limit` : i.msmeDaysLeft === 0 ? `limit is today, ${dmy(i.msmeDeadline)}` : `${i.msmeDaysLeft} days left, pay by ${dmy(i.msmeDeadline)}`}
                  {' · '}{i.status === 'blocked' ? `blocked: ${i.blockReason.toLowerCase()}` : i.inRun ? `in run ${i.inRun}` : 'in no payment run'}
                </span>
              </span>
              <span className="rt"><b className="n">{inr(i.gross)}</b><div className="t3">unit {i.companyCode}</div></span>
            </div>
          ))}
        </Card>

        <Card span="c6" icon="truck" tone="pri" title="Suppliers" subtitle="by open balance" flush>
          <div className="tablewrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr><th>Supplier</th><th className="rt">Open</th><th className="rt">Overdue</th><th className="rt">In a run</th><th>Flags</th></tr>
              </thead>
              <tbody>
                {vendors.filter((v) => v.openCount > 0).map((v) => (
                  <tr key={v.id}>
                    <td><b>{v.name}</b><div className="sub">{v.id} · {v.city}{v.ourAverageDaysLate !== null ? ` · we pay ${v.ourAverageDaysLate > 0 ? `${v.ourAverageDaysLate} d late` : 'on time'}` : ''}</div></td>
                    <td className="rt n">{inr(v.open)}</td>
                    <td className="rt n">{v.overdue ? inr(v.overdue) : <span className="muted">–</span>}</td>
                    <td className="rt n">{v.inRun ? inr(v.inRun) : <span className="muted">–</span>}</td>
                    <td>
                      <div className="checkchips" style={{ marginTop: 0 }}>
                        {v.bankChangedRecently && <Chip tone="neg" icon="alert">Bank changed</Chip>}
                        {v.msme && <Chip tone={v.msmeBreaches ? 'neg' : 'mut'}>MSME {v.msmeCategory}</Chip>}
                        {v.blocked > 0 && <Chip tone="warn">{inr(v.blocked)} blocked</Chip>}
                        {v.foreign && <Chip tone="pri">Import, {v.currency}</Chip>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card
        icon="file"
        tone="pri"
        title="Supplier invoices"
        subtitle={`${plural(items.length, 'invoice')}, ${inr(sum(items, 'gross'))}`}
        flush
      >
        <div className="toolbar" style={{ padding: '12px 17px 0' }}>
          <div className="seg" role="group" aria-label="Show">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}>
                {v.label}<span className="cnt2 n">{ap.items.filter(v.test).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tablewrap" style={{ marginTop: 12, maxHeight: 520, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr><th>Supplier</th><th>Reference</th><th>Unit</th><th>Posted</th><th>Due</th><th className="rt">Gross</th><th>Status</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.docNo} className={i.status === 'blocked' ? 'clickrow' : undefined} onClick={i.status === 'blocked' ? () => onOpenDocument('INV', i.docNo) : undefined}>
                  <td><b>{i.vendorName}</b><div className="sub">doc {i.docNo}{i.poNumber ? ` · PO ${i.poNumber}` : ''}</div></td>
                  <td className="n">{i.vendorReference}</td>
                  <td>{i.companyCode}</td>
                  <td>{dmy(i.postingDate)}</td>
                  <td>{dmy(i.dueDate)}<div className="sub" style={{ color: i.overdue ? 'var(--warn)' : undefined }}>{i.overdue ? `${-i.dueIn} d overdue` : `in ${i.dueIn} d`}</div></td>
                  <td className="rt n"><b>{inr(i.gross)}</b></td>
                  <td>{i.status === 'blocked' ? <Chip tone="warn" icon="shield">{i.blockReason}</Chip> : i.inRun ? <Chip tone="pri" icon="send">{i.inRun.replace('F110-', 'Run ')}</Chip> : <Chip tone="mut">Open</Chip>}</td>
                  <td>
                    <div className="checkchips" style={{ marginTop: 0 }}>
                      {i.duplicateOf && <Chip tone="neg" icon="alert">Duplicate of {i.duplicateOf}?</Chip>}
                      {i.msmeBreached && <Chip tone="neg">MSME {i.daysSincePosting} d</Chip>}
                      {i.msme && !i.msmeBreached && i.msmeDaysLeft <= 10 && <Chip tone="warn">MSME, {i.msmeDaysLeft} d left</Chip>}
                      {i.discount && i.discount.amount >= 50000 && <Chip tone="pos">{i.discount.percent}% off by {dmy(i.discount.by, false)}</Chip>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="footnote"><Icon name="eye" size={12} /> The posting date stands in for the date of acceptance under the MSMED Act. Blocked invoices open in the approval queue.</p>
    </>
  );
}
