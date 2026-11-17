// Cash: what is in the bank today, and an eight-week forecast built from the ledgers.

import { Fragment, useState } from 'react';
import { inr, dmy } from '../format.js';
import { Card, Chip, Icon, Tile, Banner, SimulatedNote } from '../components/ui.jsx';
import { CashLine } from '../components/finance-charts.jsx';
import { cashFor, byUnit, unitName } from '../selectors.js';

export default function Cash({ data, unit }) {
  const cash = cashFor(data, unit);
  const [open, setOpen] = useState(null);
  const accounts = byUnit(data.bankAccounts, unit);
  const lowest = cash.weeks.reduce((low, w) => (w.headroom < low.headroom ? w : low), cash.weeks[0]);
  const totalIn = cash.weeks.reduce((s, w) => s + w.inflow, 0);
  const totalOut = cash.weeks.reduce((s, w) => s + w.outflow, 0);

  return (
    <>
      {cash.short.length > 0 && (
        <Banner kind="err" icon="alert">
          <b>{cash.short.map((s) => `${unitName(data, s.companyCode)} goes past its cash credit limit in the week of ${s.week}`).join('; ')}.</b>{' '}
          A transfer from another unit, holding back non-urgent payments, or a faster collection would cover it.
        </Banner>
      )}

      <div className="tiles">
        <Tile icon="box" label="In the bank today" value={inr(cash.opening)} sub={`${accounts.length} accounts`} tone={cash.opening < 0 ? 'warn' : 'pos'} footer={accounts.some((a) => a.balance < 0) ? `${inr(-accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0))} drawn on cash credit` : 'all accounts in credit'} />
        <Tile icon="shield" label="Cash credit limits" value={inr(cash.facility)} sub={cash.facility ? `${inr(cash.facility + Math.min(0, accounts.filter((a) => a.limit).reduce((s, a) => s + a.balance, 0)))} undrawn` : 'none'} tone="mut" footer="counted as headroom" />
        <Tile icon="up" label="Expected in, 8 weeks" value={inr(totalIn)} sub="from customer invoices" tone="pos" footer="weighted by how likely each is" />
        <Tile icon="down" label="Going out, 8 weeks" value={inr(totalOut)} sub="suppliers, runs, salaries, taxes" tone="warn" footer={cash.blockedCount ? `${inr(cash.blockedValue)} blocked, not counted` : 'nothing blocked'} />
        <Tile icon="alert" label="Tightest week" value={lowest.label} sub={`headroom ${inr(lowest.headroom)}`} tone={lowest.headroom < 0 ? 'neg' : lowest.headroom < 10000000 ? 'warn' : 'pos'} footer={`closing balance ${inr(lowest.closing)}`} />
      </div>

      <div className="grid">
        <Card span="c12" icon="chart" tone={cash.short.length ? 'neg' : 'pri'} title={`Closing balance by week, ${unitName(data, unit)}`} subtitle="hover a week for money in and out; the dashed red line is the cash credit limit">
          <CashLine weeks={cash.weeks} opening={cash.opening} facility={cash.facility} height={260} />
        </Card>

        <Card span="c12" icon="people" tone="pri" title="By unit" subtitle="cash is held per company code; one unit's surplus does not pay another's bills until it is moved" flush>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Unit</th><th className="rt">In the bank today</th><th className="rt">Cash credit limit</th><th className="rt">Tomorrow's payment run</th><th className="rt">Lowest headroom, 8 weeks</th><th>Outlook</th></tr>
              </thead>
              <tbody>
                {data.companyCodes.filter((c) => unit === 'all' || c.code === unit).map((c) => {
                  const f = data.cash[c.code];
                  const low = f.weeks.reduce((m, w) => (w.headroom < m.headroom ? w : m), f.weeks[0]);
                  const run = data.approvals.find((a) => a.kind === 'RUN' && a.companyCode === c.code && a.status !== 'rejected');
                  const runShort = run && run.amount > run.detail.available;
                  return (
                    <tr key={c.code}>
                      <td><b>{c.code} {c.name}</b></td>
                      <td className="rt n">{inr(f.opening)}</td>
                      <td className="rt n">{f.facility ? inr(f.facility) : '–'}</td>
                      <td className="rt n">{run ? inr(run.amount) : '–'}{runShort && <div className="sub" style={{ color: 'var(--neg)' }}>{inr(run.amount - run.detail.available)} more than available</div>}</td>
                      <td className="rt n">{inr(low.headroom)}<div className="sub">{low.label}</div></td>
                      <td>{f.firstShortWeek ? <Chip tone="neg" icon="alert">Short from {f.firstShortWeek}</Chip> : runShort ? <Chip tone="warn" icon="alert">Fund the run first</Chip> : low.headroom < 10000000 ? <Chip tone="warn">Tight</Chip> : <Chip tone="pos" icon="check">Comfortable</Chip>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card span="c8" icon="doc" tone="pri" title="Week by week" subtitle="click a week to see what makes it up" flush>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Week</th><th className="rt">Money in</th><th className="rt">Money out</th><th className="rt">Net</th><th className="rt">Closing</th><th className="rt">Headroom</th></tr>
              </thead>
              <tbody>
                {cash.weeks.map((w) => (
                  <Fragment key={w.label}>
                    <tr className="clickrow" onClick={() => setOpen(open === w.label ? null : w.label)}>
                      <td><b>{w.label}</b></td>
                      <td className="rt n">{inr(w.inflow)}</td>
                      <td className="rt n">{inr(w.outflow)}</td>
                      <td className="rt n" style={{ color: w.net < 0 ? 'var(--neg)' : 'var(--pos)' }}>{inr(w.net)}</td>
                      <td className="rt n"><b>{inr(w.closing)}</b></td>
                      <td className="rt n">{w.headroom < 0 ? <Chip tone="neg">{inr(w.headroom)}</Chip> : inr(w.headroom)}</td>
                    </tr>
                    {open === w.label && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                          <div className="grid" style={{ gap: 18 }}>
                            <div className="c6">
                              <div className="psec" style={{ marginTop: 0 }}>LARGEST IN</div>
                              {w.lines.filter((l) => l.kind === 'inflow').slice(0, 6).map((l) => <div key={l.what} className="trow2"><span>{l.what}</span><span className="n">{inr(l.amount)}</span></div>)}
                            </div>
                            <div className="c6">
                              <div className="psec" style={{ marginTop: 0 }}>LARGEST OUT</div>
                              {w.lines.filter((l) => l.kind === 'outflow').slice(0, 6).map((l) => <div key={l.what} className="trow2"><span>{l.what}</span><span className="n">{inr(l.amount)}</span></div>)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card span="c4" icon="box" tone="pri" title="Bank accounts" subtitle="latest statement balances" flush>
          {accounts.map((a) => (
            <div className="row" key={a.id}>
              <span className={`ico bg-${a.balance < 0 ? 'warn' : 'pri'}`}><Icon name="box" size={15} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="t1">{a.bank} ****{a.last4}</span>
                <span className="t2">{a.type}, {a.branch} · unit {a.companyCode}</span>
                <span className="t3">Statement {dmy(a.statementDate)}{a.limit ? ` · limit ${inr(a.limit)}` : ''}</span>
              </span>
              <span className="rt"><b className="n" style={{ color: a.balance < 0 ? 'var(--warn)' : undefined }}>{inr(a.balance)}</b></span>
            </div>
          ))}
        </Card>
      </div>

      <SimulatedNote>
        How it is built: customer invoices on their due date plus that customer’s usual delay, weighted by how likely they are to pay; disputed ones left out. Supplier invoices on their due date, payment runs on the run date, salaries, TDS, PF, GST and loan instalments on their usual days. Blocked invoices are left out until released.
      </SimulatedNote>
    </>
  );
}
