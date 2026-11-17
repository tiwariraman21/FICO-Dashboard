// Everything waiting for a finance signature, in one queue: parked journal entries, blocked
// supplier invoices and payment runs. Worst first, with what the checks found on each.

import { useState } from 'react';
import { inr, hoursLabel, plural, when } from '../format.js';
import { Card, Chip, Icon, Banner, StatBox } from '../components/ui.jsx';
import { byUnit, sum, unitName } from '../selectors.js';

const KINDS = [
  { key: 'all', label: 'All' },
  { key: 'JE', label: 'Journal entries' },
  { key: 'INV', label: 'Blocked invoices' },
  { key: 'RUN', label: 'Payment runs' }
];

const STATES = [
  { key: 'with-you', label: 'Waiting for you' },
  { key: 'with-cfo', label: 'With the CFO' },
  { key: 'done', label: 'Decided' }
];

export function StatusChip({ doc }) {
  const tone = { 'with-you': 'warn', 'with-cfo': 'pri', approved: 'pos', rejected: 'neg' }[doc.status];
  const icon = { 'with-you': 'clock', 'with-cfo': 'people', approved: 'check', rejected: 'back' }[doc.status];
  return <Chip tone={tone} icon={icon}>{doc.statusLabel}</Chip>;
}

export default function Approvals({ data, unit, onOpenDocument }) {
  const [kind, setKind] = useState('all');
  const [state, setState] = useState('with-you');
  const [find, setFind] = useState('');

  const inUnit = byUnit(data.approvals, unit);
  const ofKind = inUnit.filter((d) => kind === 'all' || d.kind === kind);
  const inState = (d) => (state === 'done' ? d.status === 'approved' || d.status === 'rejected' : d.status === state);
  const needle = find.trim().toLowerCase();
  const rows = ofKind
    .filter(inState)
    .filter((d) => !needle || `${d.id} ${d.title} ${d.preparedBy.name}`.toLowerCase().includes(needle));

  const mine = inUnit.filter((d) => d.status === 'with-you');

  return (
    <>
      <Banner kind="info" icon="shield">
        Each document has already been checked against the ledgers: balances, attachments, timing, tolerances, MSME limits, duplicates, bank changes and cash. Open one to see the checks, who signed before you, and what happens either way.
      </Banner>

      <div className="grid" style={{ marginBottom: 13 }}>
        <div className="c3"><StatBox icon="doc" tone="warn" label="Journal entries" value={mine.filter((d) => d.kind === 'JE').length} sub={inr(sum(mine.filter((d) => d.kind === 'JE'), 'amount'))} /></div>
        <div className="c3"><StatBox icon="file" tone="warn" label="Blocked invoices" value={mine.filter((d) => d.kind === 'INV').length} sub={inr(sum(mine.filter((d) => d.kind === 'INV'), 'amount'))} /></div>
        <div className="c3"><StatBox icon="send" tone="warn" label="Payment runs" value={mine.filter((d) => d.kind === 'RUN').length} sub={inr(sum(mine.filter((d) => d.kind === 'RUN'), 'amount'))} /></div>
        <div className="c3"><StatBox icon="alert" tone="neg" label="With a problem to settle" value={mine.filter((d) => d.tone === 'neg').length} sub="look at these before signing" /></div>
      </div>

      <Card
        icon="shield"
        tone="warn"
        title="Approval queue"
        subtitle={`${plural(rows.length, 'document')}${unit === 'all' ? '' : `, ${unitName(data, unit)}`}`}
        flush
      >
        <div className="toolbar" style={{ padding: '12px 17px 0' }}>
          <div className="seg" role="group" aria-label="Kind">
            {KINDS.map((k) => (
              <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>
                {k.label}
                <span className="cnt2 n">{inUnit.filter((d) => (k.key === 'all' || d.kind === k.key) && inState(d)).length}</span>
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Status">
            {STATES.map((s) => (
              <button key={s.key} type="button" aria-pressed={state === s.key} onClick={() => setState(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          <input className="find" placeholder="Search number, title or preparer" value={find} onChange={(e) => setFind(e.target.value)} />
        </div>

        {rows.length === 0 ? (
          <p className="muted rowpad">Nothing here.</p>
        ) : (
          <div className="tablewrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Unit</th>
                  <th className="rt">Amount</th>
                  <th>Prepared by</th>
                  <th>Waiting</th>
                  <th>What the checks found</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const neg = d.checks.filter((c) => c.tone === 'neg');
                  const warn = d.checks.filter((c) => c.tone === 'warn');
                  return (
                    <tr key={`${d.kind}${d.id}`} className="clickrow" onClick={() => onOpenDocument(d.kind, d.id)}>
                      <td style={{ maxWidth: 340 }}>
                        <div className="kindchip">{d.kindLabel} {d.id}</div>
                        <b>{d.title}</b>
                        <div className="sub">{d.subtitle}</div>
                      </td>
                      <td>{d.companyCode}<div className="sub">{unitName(data, d.companyCode)}</div></td>
                      <td className="rt n"><b>{inr(d.amount)}</b>{d.needsCfo && <div className="sub">+ CFO</div>}</td>
                      <td>{d.preparedBy.name}<div className="sub">{when(d.preparedAt)}</div></td>
                      <td><Chip tone={d.hoursWaiting > 72 ? 'neg' : d.hoursWaiting > 24 ? 'warn' : 'mut'}>{hoursLabel(d.hoursWaiting)}</Chip></td>
                      <td style={{ maxWidth: 360 }}>
                        {neg.length ? (
                          <>
                            <span className="dot neg" />
                            <b style={{ color: 'var(--neg)' }}>{plural(neg.length, 'problem')}</b>
                            <div className="sub">{neg[0].text}</div>
                          </>
                        ) : warn.length ? (
                          <>
                            <span className="dot warn" />
                            <b style={{ color: 'var(--warn)' }}>{plural(warn.length, 'point')} to note</b>
                            <div className="sub">{warn[0].text}</div>
                          </>
                        ) : (
                          <><span className="dot pos" /><b style={{ color: 'var(--pos)' }}>All checks passed</b></>
                        )}
                      </td>
                      <td><StatusChip doc={d} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="footnote">
        <Icon name="eye" size={12} /> Your limits: journal entries up to {inr(data.limits.journalEntry)}, invoice releases up to {inr(data.limits.invoiceRelease)}, payment runs up to {inr(data.limits.paymentRun)}. Above those, and for every write-off, {data.people.cfo.name} signs after you.
      </p>
    </>
  );
}
