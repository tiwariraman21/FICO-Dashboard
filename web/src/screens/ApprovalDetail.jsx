// One document, laid out for a decision: what it is, what was checked, who signed before
// you, what happens either way, and the detail underneath.

import { useState } from 'react';
import { inr, rupees, dmy, when, hoursLabel, firstName, num } from '../format.js';
import { Card, Chip, Icon, Banner, Facet, TermRow } from '../components/ui.jsx';
import { unitName } from '../selectors.js';
import { StatusChip } from './Approvals.jsx';

const TONE_ICON = { pos: 'check', warn: 'alert', neg: 'alert', info: 'eye' };

export function Checks({ checks }) {
  return (
    <ul className="checks">
      {checks.map((c, i) => (
        <li key={i} className={c.tone}>
          <span className={`ci bg-${c.tone === 'info' ? 'mut' : c.tone}`}><Icon name={TONE_ICON[c.tone]} size={12} /></span>
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ApprovalDetail({ data, doc, onBack, onNavigate, busy, handlers }) {
  const [note, setNote] = useState('');
  const mayDecide = doc.status === 'with-you';
  const withCfo = doc.status === 'with-cfo';

  return (
    <>
      <section className="ohero">
        <div className="ohero-in">
          <button className="oback" onClick={onBack} type="button">
            <Icon name="back" size={14} />
            Back to the queue
          </button>
          <div className="otitle">
            <span className="oav">{doc.kind}</span>
            <div>
              <h1>{doc.title}</h1>
              <div className="os">{doc.kindLabel} {doc.id} · {doc.subtitle} · {unitName(data, doc.companyCode)} ({doc.companyCode})</div>
            </div>
            <span style={{ marginLeft: 'auto' }}><StatusChip doc={doc} /></span>
          </div>
          <div className="facets">
            <Facet label="Amount" value={inr(doc.amount)} />
            <Facet label="Prepared by" value={doc.preparedBy.name} />
            <Facet label="Prepared" value={when(doc.preparedAt)} />
            <Facet label="Waiting" value={hoursLabel(doc.hoursWaiting)} />
            <Facet label="Signatures" value={doc.needsCfo ? 'You, then the CFO' : 'You only'} />
          </div>
        </div>
      </section>

      <Banner kind={doc.tone === 'neg' ? 'err' : doc.tone === 'warn' ? 'warn' : 'ok'} icon="spark">
        <b>Before you sign.</b> {doc.advice}
      </Banner>

      <div className="grid">
        <Card span="c7" icon="shield" tone={doc.tone === 'info' ? 'pri' : doc.tone} title="What was checked" subtitle="worked out from the ledgers, not guessed">
          <p style={{ margin: '0 0 12px', fontSize: 13.2, color: 'var(--ink-2)', lineHeight: 1.55 }}>{doc.description}</p>
          <Checks checks={doc.checks} />
          {doc.unblocks.length > 0 && (
            <div className="flagline" style={{ marginTop: 12 }}>
              <Icon name="clock" size={13} /> Month-end close task waiting on this: <b>{doc.unblocks.map((u) => `${u.title} (unit ${u.companyCode})`).join(', ')}</b>
              <button className="act" type="button" onClick={() => onNavigate('close')} style={{ marginLeft: 8 }}>Open close</button>
            </div>
          )}
        </Card>

        <Card span="c5" icon="people" tone="pri" title="Who signs" subtitle="in order">
          <div className="chain">
            {doc.steps.map((s, i) => (
              <div key={i} className={`stepline ${s.state === 'done' ? 'done' : 'wait'}`}>
                <span className={`sd bg-${s.state === 'done' ? (s.role === 'prepared' ? 'mut' : 'pos') : s.state === 'rejected' ? 'neg' : s.state === 'waiting' ? 'warn' : 'mut'}`}>
                  <Icon name={s.role === 'prepared' ? 'doc' : s.state === 'done' ? 'check' : s.state === 'rejected' ? 'back' : 'clock'} size={13} />
                </span>
                <div>
                  <div className="s1">{s.name}{s.you ? ' (you)' : ''}</div>
                  <div className="s2">
                    {s.title}
                    {s.role === 'prepared' ? `, ${doc.kind === 'INV' ? 'blocked' : 'prepared'} ${when(s.when)}` : ''}
                    {s.role !== 'prepared' && s.state === 'done' ? `, approved ${when(s.when)}` : ''}
                    {s.state === 'rejected' ? `, sent back ${when(s.when)}` : ''}
                    {s.state === 'waiting' ? ', waiting now' : ''}
                    {s.state === 'pending' ? ', after you' : ''}
                  </div>
                  {s.note && <div className="s2" style={{ fontStyle: 'italic' }}>&ldquo;{s.note}&rdquo;</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="conseq" style={{ marginTop: 14, gridTemplateColumns: '1fr' }}>
            <div className="cq yes">
              <div className="cqh"><Icon name="check" size={13} />If you approve</div>
              <div className="cqt">{doc.consequence.ifApproved}</div>
            </div>
            <div className="cq no">
              <div className="cqh"><Icon name="back" size={13} />If you send it back</div>
              <div className="cqt">{doc.consequence.ifRejected}</div>
            </div>
          </div>
        </Card>

        {doc.kind === 'JE' && <JournalLines doc={doc} />}
        {doc.kind === 'INV' && <InvoiceFacts doc={doc} />}
        {doc.kind === 'RUN' && <RunLines doc={doc} />}
      </div>

      {(mayDecide || withCfo) && (
        <div className="footerbar">
          {withCfo ? (
            <>
              <span className="muted" style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="shield" size={13} /> Yours is signed. {data.people.cfo.name} has it now.
              </span>
              <button className="btn emph" type="button" style={{ marginLeft: 'auto' }} disabled={busy !== null} onClick={() => handlers.remindCfo(doc)}>
                <Icon name="mail" size={13} />
                {busy === 'remind' ? 'Sending…' : `Remind ${firstName(data.people.cfo.name)}`}
              </button>
            </>
          ) : (
            <>
              <span className="muted" style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="shield" size={13} /> Signing as {data.me.name}
              </span>
              <input className="noteinput" placeholder={doc.tone === 'neg' ? 'Note (needed to send back)' : 'Note for the preparer'} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy !== null} />
              <button className="btn rej" onClick={() => handlers.decide(doc, 'reject', note)} disabled={busy !== null || !note.trim()} title={note.trim() ? '' : 'Write a note first, so the preparer knows what to change'} type="button">
                {busy === 'reject' ? 'Saving…' : 'Send back'}
              </button>
              <button className="btn emph" onClick={() => handlers.decide(doc, 'approve', note)} disabled={busy !== null} type="button">
                <Icon name="check" size={13} />
                {busy === 'approve' ? 'Saving…' : doc.needsCfo ? 'Approve and pass to the CFO' : doc.kind === 'RUN' ? 'Approve the run' : doc.kind === 'INV' ? 'Release for payment' : 'Approve and post'}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function JournalLines({ doc }) {
  const lines = doc.detail.lines;
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  return (
    <Card span="c12" icon="doc" tone="pri" title="Journal lines" subtitle={`${doc.detail.type}${doc.detail.reversal ? `, ${doc.detail.reversal.toLowerCase()}` : ''}, ${doc.detail.attachments} attachment${doc.detail.attachments === 1 ? '' : 's'}`} flush>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>GL account</th><th>Cost centre</th><th>Line text</th><th className="rt">Debit</th><th className="rt">Credit</th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><b className="n">{l.gl}</b><div className="sub">{l.glName}</div></td>
                <td className="n">{l.costCentre || '–'}</td>
                <td>{l.text}</td>
                <td className="rt dr">{l.debit ? rupees(l.debit) : ''}</td>
                <td className="rt cr">{l.credit ? rupees(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total {Math.abs(dr - cr) < 1 ? '(balanced)' : '(out of balance)'}</td><td className="rt n">{rupees(dr)}</td><td className="rt n">{rupees(cr)}</td></tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function InvoiceFacts({ doc }) {
  const d = doc.detail;
  const v = d.variance || {};
  return (
    <Card span="c12" icon="file" tone="pri" title="The invoice" subtitle={`${d.vendorName}, against order ${d.poNumber || 'none'}`}>
      <div className="terms">
        <div>
          <TermRow label="Vendor" value={`${d.vendorName} (${d.vendorId})`} />
          <TermRow label="Their reference" value={d.vendorReference} />
          <TermRow label="Purchase order" value={d.poNumber || '–'} />
          <TermRow label="Invoice date" value={dmy(d.invoiceDate)} />
          <TermRow label="Posted" value={dmy(d.postingDate)} />
          <TermRow label="Due" value={dmy(d.dueDate)} />
        </div>
        <div>
          <TermRow label="Gross" value={rupees(d.gross)} />
          <TermRow label="TDS deducted" value={rupees(d.tds)} />
          <TermRow label="Net payable" value={rupees(d.net)} big />
          <TermRow label="Block reason" value={d.blockReason} />
          {v.kind === 'price' && <TermRow label="Price, order vs invoice" value={`${rupees(v.poPrice)} vs ${rupees(v.invoicePrice)} per ${v.unit}`} />}
          {v.kind === 'quantity' && <TermRow label="Quantity, received vs invoiced" value={`${num(v.receivedQuantity)} vs ${num(v.invoicedQuantity)} ${v.unit}`} />}
          {d.difference > 0 && <TermRow label="Difference" value={inr(d.difference)} />}
        </div>
      </div>
    </Card>
  );
}

function RunLines({ doc }) {
  const d = doc.detail;
  return (
    <Card span="c12" icon="send" tone="pri" title="What the run pays" subtitle={`${d.lines.length} invoices from ${d.bankAccount ? `${d.bankAccount.bank} ****${d.bankAccount.last4}` : 'the bank'} on ${dmy(d.runDate)}`} flush>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Vendor</th><th>Reference</th><th>Due</th><th className="rt">Net</th><th>Flags</th></tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.docNo}>
                <td><b>{l.vendorName}</b><div className="sub">{l.vendorId} · doc {l.docNo}</div></td>
                <td className="n">{l.vendorReference}</td>
                <td>{dmy(l.dueDate)}{l.overdue && <div className="sub" style={{ color: 'var(--warn)' }}>overdue</div>}</td>
                <td className="rt n"><b>{inr(l.net)}</b></td>
                <td>
                  <div className="checkchips">
                    {l.duplicate && <Chip tone="neg" icon="alert">Possible duplicate</Chip>}
                    {l.bankChanged && <Chip tone="neg" icon="alert">Bank changed</Chip>}
                    {l.msmeBreached && <Chip tone="warn">MSME, {l.daysSincePosting} days</Chip>}
                    {l.msme && !l.msmeBreached && <Chip tone="mut">MSME</Chip>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total, against {inr(d.available)} available in the unit</td><td className="rt n">{inr(doc.amount)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

