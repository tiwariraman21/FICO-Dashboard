// The month-end close: where every task stands against its working day, which are waiting
// on your approval, and a nudge for anything late.

import { useState } from 'react';
import { dmy, plural, when } from '../format.js';
import { Card, Chip, Icon, StatBox } from '../components/ui.jsx';
import { CloseBar, TASK_STATES } from '../components/finance-charts.jsx';
import { closeFor, unitName } from '../selectors.js';

const VIEWS = [
  { key: 'open', label: 'Not done', test: (t) => t.status !== 'done' },
  { key: 'late', label: 'Late', test: (t) => t.late },
  { key: 'you', label: 'Waiting on you', test: (t) => t.waitingOnYou },
  { key: 'all', label: 'All', test: () => true }
];

const toneOf = (status) => TASK_STATES.find((s) => s.key === status)?.tone || 'mut';

export default function Close({ data, unit, onOpenDocument, busy, handlers }) {
  const close = closeFor(data, unit);
  const [view, setView] = useState('open');
  const [blocking, setBlocking] = useState(null); // task id being marked blocked, waiting for a reason
  const [reason, setReason] = useState('');
  const rows = close.tasks.filter(VIEWS.find((v) => v.key === view).test).sort((a, b) => a.workingDay - b.workingDay || a.companyCode.localeCompare(b.companyCode));
  const wd = data.close.workingDay;
  const days = [...new Set(close.tasks.map((t) => t.workingDay))].sort((a, b) => a - b);

  return (
    <>
      <Card icon="clock" tone={close.late.length ? 'warn' : 'pos'} title={`${data.fiscal.closingPeriodLabel} close, ${unitName(data, unit)}`} subtitle={`today is working day ${wd}; the management pack is due on working day 8`}>
        <div className="wdstrip" aria-label="Close calendar">
          {days.map((d) => {
            const due = close.tasks.filter((t) => t.workingDay === d);
            const open = due.filter((t) => t.status !== 'done').length;
            return (
              <div key={d} className={`wd${d === wd ? ' today' : d < wd ? ' past' : ''}`} title={`${plural(due.length, 'task')} due, ${open} not done`}>
                <b>WD{d}</b>
                {due.length ? `${due.length - open}/${due.length}` : '–'}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 14 }}><CloseBar tasks={close.tasks} /></div>
        <div className="flegend" style={{ marginTop: 10, marginBottom: 0 }}>
          {TASK_STATES.map((s) => (
            <span key={s.key}><span className={`dot ${s.tone}`} />{s.label} <b className="n">{close.tasks.filter((t) => t.status === s.key).length}</b></span>
          ))}
        </div>
      </Card>

      <div className="grid" style={{ margin: '13px 0' }}>
        <div className="c3"><StatBox icon="check" tone="pos" label="Done" value={`${close.done}/${close.tasks.length}`} sub={`${Math.round((close.done / (close.tasks.length || 1)) * 100)}% of the checklist`} /></div>
        <div className="c3"><StatBox icon="clock" tone="warn" label="Late" value={close.late.length} sub="past their working day" /></div>
        <div className="c3"><StatBox icon="alert" tone="neg" label="Blocked" value={close.blocked.length} sub="need something from outside" /></div>
        <div className="c3"><StatBox icon="shield" tone="pri" label="Waiting on your approval" value={close.waitingOnYou.length} sub="sign the entry to free them" /></div>
      </div>

      <Card icon="doc" tone="pri" title="Checklist" subtitle={`${plural(rows.length, 'task')}`} flush>
        <div className="toolbar" style={{ padding: '12px 17px 0' }}>
          <div className="seg" role="group" aria-label="Show">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}>
                {v.label}<span className="cnt2 n">{close.tasks.filter(v.test).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr><th>Due</th><th>Task</th><th>Unit</th><th>Owner</th><th>Where it stands</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="n"><b>WD{t.workingDay}</b><div className="sub">{dmy(t.dueDate, false)}</div></td>
                  <td style={{ maxWidth: 280 }}><b>{t.title}</b><div className="sub">{t.area} · {t.tcode}</div></td>
                  <td>{t.companyCode}</td>
                  <td>{t.owner}<div className="sub">{t.ownerTitle}</div></td>
                  <td style={{ maxWidth: 340 }}>
                    {t.late && <Chip tone="warn" icon="clock">Late</Chip>}{' '}
                    {t.waitingOn.filter((w) => w.withYou).map((w) => (
                      <button key={w.id} type="button" className="act" style={{ padding: '2px 6px' }} onClick={() => onOpenDocument('JE', w.id)}>Approve JE {w.id}</button>
                    ))}
                    <div className="sub">{t.status === 'done' ? `Done ${t.completedAt ? when(t.completedAt) : ''}` : t.note || '–'}</div>
                    {blocking === t.id && (
                      <div className="formrow">
                        <input autoFocus placeholder="What is it blocked on?" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <button className="btn" type="button" disabled={!reason.trim() || busy !== null} onClick={async () => { await handlers.setTaskStatus(t, 'blocked', reason); setBlocking(null); setReason(''); }}>Save</button>
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      className="taskstatus"
                      value={t.status}
                      disabled={busy !== null}
                      aria-label={`Status of ${t.title}`}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === 'blocked') setBlocking(t.id);
                        else handlers.setTaskStatus(t, next, '');
                      }}
                      style={{ borderColor: `var(--${toneOf(t.status) === 'pri' ? 'primary' : toneOf(t.status) === 'mut' ? 'border-2' : toneOf(t.status)})` }}
                    >
                      {['done', 'in progress', 'waiting', 'not started', 'blocked'].map((s) => (
                        <option key={s} value={s} disabled={s === 'waiting'}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {t.status !== 'done' && (t.late || t.status === 'blocked') && (
                      <button className="btn sm" type="button" disabled={busy !== null} onClick={() => handlers.nudgeTask(t)}>
                        <Icon name="mail" size={12} /> {busy === `nudge:${t.id}` ? 'Sending…' : 'Nudge'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
