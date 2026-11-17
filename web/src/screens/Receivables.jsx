// Receivables: who owes what, how old it is, and who to chase first. Pick a customer to
// see their position and send a reminder or record a promise to pay.

import { useEffect, useState } from 'react';
import { inr, dmy, bandTone, plural, monthLabel } from '../format.js';
import { Card, Chip, Icon, Tile, Banner } from '../components/ui.jsx';
import { AgeingBar, AGE_BUCKETS, PairBars } from '../components/finance-charts.jsx';
import { receivablesFor, byUnit, unitName, sum } from '../selectors.js';

export default function Receivables({ data, unit, focus, busy, handlers }) {
  const ar = receivablesFor(data, unit);
  const [picked, setPicked] = useState(focus || null);
  const [bucket, setBucket] = useState(null);
  const [band, setBand] = useState('all');

  useEffect(() => {
    if (focus) setPicked(focus);
  }, [focus]);

  const customers = ar.customers.filter((c) => band === 'all' || c.band === band);
  const selected = ar.customers.find((c) => c.id === picked) || null;

  // Billing and collections by month for this financial year.
  const fyStart = `${data.fiscal.year.slice(0, 4)}-04`;
  const months = {};
  for (const h of byUnit(data.receivables.history, unit)) {
    if (h.month < fyStart || h.month > data.asOf.slice(0, 7)) continue;
    months[h.month] = months[h.month] || { label: monthLabel(h.month), a: 0, b: 0 };
    months[h.month].a += h.billed;
    months[h.month].b += h.collected;
  }
  const monthRows = Object.keys(months).sort().map((k) => months[k]);
  if (monthRows.length) monthRows[monthRows.length - 1].label += ' (to date)';

  return (
    <>
      <div className="tiles">
        <Tile icon="up" label="Outstanding" value={inr(ar.total)} sub={plural(ar.items.length, 'open invoice')} tone="pri" footer={`${plural(ar.customers.filter((c) => c.exposure > 0).length, 'customer')}`} />
        <Tile icon="clock" label="Overdue" value={inr(ar.overdue)} sub={`${Math.round((ar.overdue / (ar.total || 1)) * 100)}% of outstanding`} tone="warn" footer={`${plural(ar.items.filter((i) => i.daysOverdue > 0).length, 'invoice')}`} />
        <Tile icon="alert" label="Over 90 days" value={inr(ar.buckets.d90 || 0)} sub="the hardest to collect" tone={ar.buckets.d90 ? 'neg' : 'pos'} footer={ar.buckets.d90 ? 'consider a provision' : 'nothing this old'} />
        <Tile icon="chart" label="Days sales outstanding" value={ar.dso ?? '–'} unit="days" sub="owed, over average daily billing" tone="mut" footer="last 90 days of billing" />
        <Tile icon="people" label="Customers to act on now" value={ar.customers.filter((c) => c.band === 'high').length} sub="over limit, 90+ days or broken promise" tone="neg" footer="listed first below" />
      </div>

      <div className="grid" style={{ marginBottom: 13 }}>
        <Card span="c7" icon="clock" tone="warn" title="How old the money is" subtitle="click a band to list just those invoices below">
          <AgeingBar buckets={ar.buckets} picked={bucket} onPick={setBucket} />
          <div className="agetable tablewrap">
            <table style={{ minWidth: 520 }}>
              <thead>
                <tr><th>Unit</th>{AGE_BUCKETS.map((b) => <th key={b.key} className="rt">{b.label}</th>)}<th className="rt">DSO</th></tr>
              </thead>
              <tbody>
                {data.companyCodes.map((cc) => {
                  const u = receivablesFor(data, cc.code);
                  return (
                    <tr key={cc.code} className={unit === cc.code ? 'on' : ''}>
                      <td>{cc.code} {cc.name}</td>
                      {AGE_BUCKETS.map((b) => <td key={b.key} className="rt n">{inr(u.buckets[b.key] || 0)}</td>)}
                      <td className="rt n">{u.dso ?? '–'} d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card span="c5" icon="chart" tone="pri" title="Billed against collected" subtitle={`by month, ${data.fiscal.year}`}>
          <PairBars rows={monthRows} aLabel="Billed" bLabel="Collected" height={150} />
        </Card>
      </div>

      <div className="split">
        <Card
          icon="people"
          tone="pri"
          title="Customers"
          subtitle="act-now first, then by overdue value; click one for the detail"
          flush
          beside={
            <div className="seg" role="group" aria-label="Standing" style={{ marginLeft: 'auto' }}>
              {[['all', 'All'], ['high', 'Act now'], ['watch', 'Watch'], ['good', 'Good']].map(([k, l]) => (
                <button key={k} type="button" aria-pressed={band === k} onClick={() => setBand(k)}>{l}</button>
              ))}
            </div>
          }
        >
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="rt">Owes</th>
                  <th className="rt">Overdue</th>
                  <th>Credit used</th>
                  <th className="rt">Usually late</th>
                  <th>Standing</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="clickrow" onClick={() => setPicked(c.id)} style={picked === c.id ? { background: 'var(--surface-2)' } : undefined}>
                    <td style={{ maxWidth: 260 }}>
                      <b>{c.name}</b>
                      <div className="sub">{c.reasons[0] || `${unitName(data, c.companyCode)}, ${c.segment.toLowerCase()}`}</div>
                    </td>
                    <td className="rt n">{inr(c.exposure)}</td>
                    <td className="rt n"><b style={{ color: c.overdue ? 'var(--ink)' : 'var(--ink-3)' }}>{inr(c.overdue)}</b>{c.oldestOverdueDays > 0 && <div className="sub">oldest {c.oldestOverdueDays} d</div>}</td>
                    <td>
                      <span className="minimeter"><span style={{ width: `${Math.min(100, c.creditUsedPercent)}%`, background: c.creditUsedPercent > 100 ? 'var(--neg)' : c.creditUsedPercent > 85 ? 'var(--warn)' : 'var(--primary)' }} /></span>
                      <span className="n" style={{ marginLeft: 8, fontSize: 12.4 }}>{c.creditUsedPercent}%</span>
                    </td>
                    <td className="rt n">{c.averageDaysLate ?? '–'} d</td>
                    <td><Chip tone={bandTone(c.band)}>{c.bandLabel}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="sticky">
          {selected ? (
            <CustomerPanel c={selected} data={data} busy={busy} handlers={handlers} />
          ) : (
            <Card icon="eye" tone="pri" title="Pick a customer" subtitle="their position, history and actions appear here">
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Click any row on the left.</p>
            </Card>
          )}
        </div>
      </div>

      <div style={{ marginTop: 13 }}>
        <OpenItems data={data} items={ar.items.filter((i) => (!bucket || i.bucket === bucket) && (!picked || !selected || i.customerId === picked))} bucket={bucket} selected={selected} onClear={() => { setBucket(null); setPicked(null); }} />
      </div>
    </>
  );
}

function CustomerPanel({ c, data, busy, handlers }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const level = c.reminderLevel || 1;
  return (
    <Card icon="people" tone={bandTone(c.band)} title={c.name} subtitle={`${c.id} · ${unitName(data, c.companyCode)} · ${c.segment}`}>
      {c.reasons.length > 0 && (
        <Banner kind={c.band === 'high' ? 'err' : c.band === 'watch' ? 'warn' : 'info'} icon="alert">
          {c.reasons.map((r, i) => <div key={i}>{r.charAt(0).toUpperCase() + r.slice(1)}</div>)}
        </Banner>
      )}
      <dl className="kvlist">
        <dt>Owes</dt><dd className="n">{inr(c.exposure)}</dd>
        <dt>Overdue</dt><dd className="n">{inr(c.overdue)}</dd>
        <dt>Credit limit</dt><dd className="n">{inr(c.creditLimit)} ({c.creditUsedPercent}% used)</dd>
        <dt>Terms</dt><dd>{c.paymentTermsDays} days</dd>
        <dt>Usually pays</dt><dd>{c.averageDaysLate ?? '–'} days after due ({c.trend})</dd>
        <dt>DSO</dt><dd>{c.dso ?? '–'} days</dd>
        <dt>Contact</dt><dd>{c.contact}</dd>
        <dt>Account manager</dt><dd>{c.accountManager}</dd>
        <dt>Last reminder</dt><dd>{c.lastReminder ? `Level ${c.lastReminder.level}, ${dmy(c.lastReminder.sentAt.slice(0, 10))}` : 'None'}</dd>
      </dl>

      <div className="psec">BY AGE</div>
      <dl className="kvlist">
        {AGE_BUCKETS.map((b) => (
          <FragmentRow key={b.key} k={<><span className="dot" style={{ background: b.colour }} />{b.label}</>} v={inr(c.buckets[b.key])} />
        ))}
      </dl>

      {c.promises.length > 0 && (
        <>
          <div className="psec">PROMISES TO PAY</div>
          {c.promises.map((p) => (
            <div key={p.id} className="trow2" style={{ padding: '3px 0', fontSize: 13 }}>
              <span>{inr(p.amount)} by {dmy(p.promisedFor)}</span>
              <Chip tone={p.status === 'broken' ? 'neg' : p.status === 'kept' ? 'pos' : 'pri'}>{p.status}</Chip>
            </div>
          ))}
        </>
      )}

      <div className="psec">ACTIONS</div>
      <button className="btn emph" type="button" style={{ width: '100%', justifyContent: 'center' }} disabled={!c.overdue || busy !== null} onClick={() => handlers.remindCustomer(c, level)}>
        <Icon name="mail" size={13} />
        {busy === `remind:${c.id}` ? 'Sending…' : c.overdue ? `Send level ${level} reminder for ${inr(c.overdue)}` : 'Nothing overdue to remind about'}
      </button>
      <div className="formrow">
        <input type="number" min="1" placeholder="Promised amount, ₹" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input type="date" min={data.asOf} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Promised by" />
        <button className="btn" type="button" disabled={!amount || !date || busy !== null} onClick={async () => { const r = await handlers.recordPromise(c, Number(amount), date, ''); if (r) { setAmount(''); setDate(''); } }}>
          Record promise
        </button>
      </div>
    </Card>
  );
}

function FragmentRow({ k, v }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="n">{v}</dd>
    </>
  );
}

function OpenItems({ data, items, bucket, selected, onClear }) {
  const label = [selected?.name, bucket && AGE_BUCKETS.find((b) => b.key === bucket)?.label.toLowerCase()].filter(Boolean).join(', ');
  return (
    <Card
      icon="file"
      tone="pri"
      title="Open invoices"
      subtitle={`${plural(items.length, 'invoice')}, ${inr(sum(items, 'openAmount'))}${label ? `, ${label}` : ''}`}
      action={label ? <button className="act" type="button" onClick={onClear}>Show all</button> : null}
      flush
    >
      <div className="tablewrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr><th>Invoice</th><th>Customer</th><th>Unit</th><th>Invoice date</th><th>Due</th><th className="rt">Days overdue</th><th className="rt">Open</th><th /></tr>
          </thead>
          <tbody>
            {items.slice(0, 200).map((i) => (
              <tr key={i.docNo}>
                <td className="n"><b>{i.docNo}</b><div className="sub">{i.reference}</div></td>
                <td>{i.customerName}</td>
                <td>{i.companyCode}</td>
                <td>{dmy(i.invoiceDate)}</td>
                <td>{dmy(i.dueDate)}</td>
                <td className="rt n">{i.daysOverdue > 0 ? <Chip tone={i.daysOverdue > 90 ? 'neg' : i.daysOverdue > 30 ? 'warn' : 'mut'}>{i.daysOverdue}</Chip> : <span className="muted">not due</span>}</td>
                <td className="rt n"><b>{inr(i.openAmount)}</b>{i.partiallyPaid && <div className="sub">part paid</div>}</td>
                <td style={{ maxWidth: 260 }}>{i.disputed && <Chip tone="warn" icon="alert">Disputed</Chip>}{i.disputed && <div className="sub">{i.disputeNote}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.frozen && <p className="footnote" style={{ padding: '0 17px 12px' }}>Ageing is counted to {dmy(data.asOf)}, the day the sample data is dated.</p>}
    </Card>
  );
}
