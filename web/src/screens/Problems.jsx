// Problems found: the morning checks, run for you. Each has the evidence, an owner and one
// suggested fix. Handing it over records it and mails the owner the instruction.

import { useState } from 'react';
import { inr, when, plural } from '../format.js';
import { Card, Chip, Icon, Banner } from '../components/ui.jsx';
import { byUnit, unitName } from '../selectors.js';

const ICONS = {
  'bank-change': 'shield', duplicate: 'file', cash: 'box', msme: 'clock', customer: 'people', dispute: 'alert',
  discount: 'spark', journal: 'doc', grir: 'truck', budget: 'chart', close: 'clock'
};

export default function Problems({ data, unit, onNavigate, onOpenDocument, busy, handlers }) {
  const all = byUnit(data.problems, unit);
  const [show, setShow] = useState('open');
  const [notes, setNotes] = useState({});
  const rows = all.filter((p) => (show === 'open' ? !p.fixed : show === 'high' ? !p.fixed && p.severity === 'high' : Boolean(p.fixed)));

  function go(p) {
    if (p.link.screen === 'approvals' && p.link.id) {
      const doc = data.approvals.find((d) => d.id === p.link.id);
      if (doc) return onOpenDocument(doc.kind, doc.id);
    }
    return onNavigate(p.link.screen, p.link.id || null);
  }

  return (
    <>
      <Banner kind="info" icon="spark">
        These checks run every time the dashboard loads, against the same data the other screens show: duplicate invoices, bank details changed before a payment, MSME invoices past 45 days, customers over their limit, runs the bank cannot fund, discounts about to lapse, unusual journal entries, old GR/IR items, budget overruns and stuck close tasks. <b>Handing one over</b> records it and mails the owner exactly what to do in SAP.
      </Banner>

      <Card
        icon="alert"
        tone="warn"
        title="Problems found"
        subtitle={`${plural(all.filter((p) => !p.fixed).length, 'open problem')}${unit === 'all' ? '' : `, ${unitName(data, unit)}`}`}
        flush
        beside={
          <div className="seg" role="group" aria-label="Show" style={{ marginLeft: 'auto' }}>
            {[['open', 'Open'], ['high', 'High only'], ['fixed', 'Handed over']].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
                {l}<span className="cnt2 n">{all.filter((p) => (k === 'open' ? !p.fixed : k === 'high' ? !p.fixed && p.severity === 'high' : Boolean(p.fixed))).length}</span>
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 && <p className="muted rowpad">Nothing here.</p>}
        {rows.map((p) => (
          <div key={p.id} className={`prob${p.fixed ? ' fixed' : ''}`}>
            <span className={`ico bg-${p.fixed ? 'pos' : p.severity === 'high' ? 'neg' : 'warn'}`}><Icon name={p.fixed ? 'check' : ICONS[p.type] || 'alert'} size={16} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="checkchips" style={{ marginTop: 0 }}>
                <Chip tone={p.severity === 'high' ? 'neg' : 'warn'}>{p.typeLabel}</Chip>
                <Chip tone="mut">{unitName(data, p.companyCode)}</Chip>
                {p.value > 0 && <Chip tone="mut">{inr(p.value)}</Chip>}
              </div>
              <h3>{p.title}</h3>
              <p className="pd">{p.detail}</p>
              <ul>{p.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <div className="pfix"><b>Suggested fix, for {p.owner.name}:</b> {p.fix.instruction}</div>
            </div>
            <div className="pact">
              {p.fixed ? (
                <>
                  <Chip tone="pos" icon="check">Handed over</Chip>
                  <span className="sub" style={{ textAlign: 'right' }}>by {p.fixed.fixedBy}, {when(p.fixed.fixedAt)}</span>
                </>
              ) : (
                <>
                  <button className="btn emph" type="button" disabled={busy !== null} onClick={() => handlers.fixProblem(p, notes[p.id] || '')}>
                    <Icon name="send" size={12} />
                    {busy === `fix:${p.id}` ? 'Sending…' : p.fix.label}
                  </button>
                  <input className="noteinput" style={{ width: '100%' }} placeholder={`Add a note for ${p.owner.name.replace(/^(Mr|Ms|Mrs)\.\s*/, '').split(' ')[0]}`} value={notes[p.id] || ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} />
                </>
              )}
              <button className="act" type="button" onClick={() => go(p)}>Open the detail</button>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
