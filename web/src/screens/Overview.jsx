// The first screen: what needs a decision today, and how the money stands.

import { inr, plural, firstName, greeting, bandTone, hoursLabel } from '../format.js';
import { Card, Tile, Chip, Icon } from '../components/ui.jsx';
import { SparkArea, Donut, Meter, toneColour } from '../components/charts.jsx';
import { CashLine, VarianceBars } from '../components/finance-charts.jsx';
import { waitingForMe, openProblems, byUnit, cashFor, receivablesFor, payablesFor, closeFor, sum, unitName } from '../selectors.js';

export default function Overview({ data, unit, onNavigate, onOpenDocument, onOpenLog }) {
  const mine = waitingForMe(data.approvals, unit);
  const risky = mine.filter((d) => d.tone === 'neg');
  const cash = cashFor(data, unit);
  const ar = receivablesFor(data, unit);
  const ap = payablesFor(data, unit);
  const close = closeFor(data, unit);
  const problems = openProblems(data.problems, unit);
  const budgets = byUnit(data.budgets, unit);
  const over = budgets.filter((b) => b.status === 'over');
  const actNow = ar.customers.filter((c) => c.band === 'high');
  const where = unit === 'all' ? '' : ` in ${unitName(data, unit)}`;
  const lowest = cash.weeks.reduce((low, w) => (w.headroom < low.headroom ? w : low), cash.weeks[0]);

  return (
    <>
      <section className="hero">
        <div className="hero-in">
          <div>
            <span className="live">
              <span className="pulse" />
              {data.frozen ? 'Sample data' : 'Checked'} as of {data.asOf.split('-').reverse().join('.')}
            </span>

            <h1>
              {greeting()}, {firstName(data.me.name)}.{' '}
              {mine.length ? `${plural(mine.length, 'document')} waiting for your signature` : 'Nothing is waiting for your signature'}
              {where}
            </h1>

            <p className="lede">
              {mine.length > 0 && `${inr(sum(mine, 'amount'))} in all; ${risky.length ? `${risky.length} ${risky.length === 1 ? 'has' : 'have'} something to settle first` : 'every check passed'}. `}
              {cash.short.length
                ? `${cash.short.map((s) => unitName(data, s.companyCode)).join(' and ')} ${cash.short.length === 1 ? 'goes' : 'go'} past ${cash.short.length === 1 ? 'its' : 'their'} cash credit limit in the week of ${cash.short[0].week}. `
                : `Cash stays within limits for eight weeks. `}
              {actNow.length ? `${plural(actNow.length, 'customer')} need${actNow.length === 1 ? 's' : ''} action now, ${actNow[0].name} first. ` : ''}
              {`The ${data.fiscal.closingPeriodLabel} close is on working day ${data.close.workingDay}, ${close.late.length} ${close.late.length === 1 ? 'task' : 'tasks'} late.`}
            </p>

            <div className="hchips">
              {mine.slice(0, 3).map((d, i) => (
                <button key={`${d.kind}${d.id}`} className={`hchip${i === 0 && d.tone === 'neg' ? ' hot' : ''}`} onClick={() => onOpenDocument(d.kind, d.id)} type="button">
                  <span className="r">{i + 1}</span>
                  <span>
                    <span className="t">{d.kindLabel} {d.id}, {inr(d.amount)}</span>
                    <span className="s">{d.title}, waiting {hoursLabel(d.hoursWaiting)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button className="ring saved" onClick={() => onNavigate('close')} type="button">
            <span style={{ color: '#fff' }}>
              <Donut fraction={close.tasks.length ? close.done / close.tasks.length : 0} colour="#4FE0B0" size={104} label={`${close.done}/${close.tasks.length}`} sublabel="tasks done" />
            </span>
            <div>
              <div className="big n">WD {data.close.workingDay}</div>
              <div className="cap">of the {data.fiscal.closingPeriodLabel} close, {close.waitingOnYou.length} {close.waitingOnYou.length === 1 ? 'task' : 'tasks'} waiting on your approval</div>
              <span className="ringcta">Open the close tracker</span>
            </div>
          </button>
        </div>
      </section>

      <div className="tiles">
        <Tile
          icon="shield"
          label="Waiting for your signature"
          value={mine.length}
          sub={inr(sum(mine, 'amount'))}
          tone={risky.length ? 'neg' : mine.length ? 'warn' : 'pos'}
          footer={risky.length ? `${risky.length} with a problem to settle` : 'all checks passed'}
          onClick={() => onNavigate('approvals')}
        />
        <Tile
          icon="up"
          label="Receivables overdue"
          value={inr(ar.overdue)}
          sub={`of ${inr(ar.total)} outstanding`}
          tone={ar.buckets.d90 ? 'neg' : 'warn'}
          footer={`DSO ${ar.dso ?? '–'} days, ${inr(ar.buckets.d90 || 0)} over 90`}
          onClick={() => onNavigate('receivables')}
        />
        <Tile
          icon="down"
          label="Payables due this week"
          value={inr(ap.dueWeek)}
          sub={`${inr(ap.overdue)} already overdue`}
          tone={ap.msmeBreached.length ? 'neg' : 'warn'}
          footer={ap.msmeBreached.length ? `${plural(ap.msmeBreached.length, 'MSME invoice')} past 45 days` : 'no MSME invoice past 45 days'}
          onClick={() => onNavigate('payables')}
        />
        <Tile
          icon="box"
          label="Cash in the bank"
          value={inr(cash.opening)}
          sub={cash.facility ? `${inr(cash.facility)} cash credit limit` : 'no overdraft facility'}
          tone={cash.short.length ? 'neg' : 'pos'}
          footer={cash.short.length ? `short in the week of ${cash.short[0].week}` : `lowest headroom ${inr(lowest.headroom)}`}
          spark={<SparkArea values={[cash.opening, ...cash.weeks.map((w) => w.closing)]} colour={toneColour(cash.short.length ? 'neg' : 'pos')} />}
          onClick={() => onNavigate('cash')}
        />
        <Tile
          icon="chart"
          label="Cost centres over budget"
          value={over.length}
          sub={`of ${budgets.length}, to ${data.fiscal.closingPeriodLabel.split(' ')[0]}`}
          tone={over.length ? 'neg' : 'pos'}
          footer={over.length ? `${over[0].name}, ${over[0].companyCode}: +${over[0].variancePercent}%` : 'all within plan'}
          onClick={() => onNavigate('budgets')}
        />
        <Tile
          icon="alert"
          label="Problems found"
          value={problems.length}
          sub="already checked for you"
          tone={problems.some((p) => p.severity === 'high') ? 'neg' : problems.length ? 'warn' : 'pos'}
          footer={`${problems.filter((p) => p.severity === 'high').length} high, each with an owner`}
          onClick={() => onNavigate('problems')}
        />
      </div>

      <div className="grid">
        <Card span="c7" icon="shield" tone={risky.length ? 'neg' : 'warn'} title="Waiting for your signature" subtitle="worst first, with what the checks found" flush
          action={<button className="act" onClick={() => onNavigate('approvals')} type="button">View all</button>}>
          {mine.length === 0 ? (
            <p className="muted rowpad">Nothing is waiting{where}.</p>
          ) : (
            mine.slice(0, 7).map((d) => (
              <button key={`${d.kind}${d.id}`} className="row" onClick={() => onOpenDocument(d.kind, d.id)} type="button">
                <span className={`ico bg-${d.tone === 'info' ? 'pri' : d.tone}`}>
                  <Icon name={d.kind === 'JE' ? 'doc' : d.kind === 'INV' ? 'file' : 'send'} size={15} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="t1">{d.title}</span>
                  <span className="t2">{d.kindLabel} {d.id} · {unitName(data, d.companyCode)} · {d.preparedBy.name}, {hoursLabel(d.hoursWaiting)} ago</span>
                  {d.tone === 'neg' && <span className="t3" style={{ color: 'var(--neg)' }}>{d.checks.find((c) => c.tone === 'neg').text}</span>}
                </span>
                <span className="rt">
                  <b className="n">{inr(d.amount)}</b>
                  {d.needsCfo && <div className="t3">CFO signs after you</div>}
                </span>
              </button>
            ))
          )}
        </Card>

        <Card span="c5" icon="up" tone={actNow.length ? 'neg' : 'pos'} title="Customers to chase" subtitle="act-now first, then by overdue value" flush
          action={<button className="act" onClick={() => onNavigate('receivables')} type="button">View all</button>}>
          {ar.customers.filter((c) => c.overdue > 0).slice(0, 6).map((c, i) => (
            <button key={c.id} className="row" onClick={() => onNavigate('receivables', c.id)} type="button">
              <span className={`prio bg-${bandTone(c.band)}`}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="t1">{c.name}</span>
                <span className="t2">{c.reasons[0] || `${inr(c.overdue)} overdue`}</span>
                <Meter percent={Math.min(100, c.creditUsedPercent || 0)} colour={toneColour(c.creditUsedPercent > 100 ? 'neg' : c.creditUsedPercent > 85 ? 'warn' : 'pri')} />
              </span>
              <span className="rt">
                <Chip tone={bandTone(c.band)}>{inr(c.overdue)}</Chip>
                <div className="t3" style={{ marginTop: 6 }}>{c.creditUsedPercent}% of limit</div>
              </span>
            </button>
          ))}
        </Card>

        <Card span="c7" icon="box" tone={cash.short.length ? 'neg' : 'pri'} title={`Cash, next eight weeks${where}`} subtitle="closing bank balance each week; below the red line the cash credit limit is breached"
          action={<button className="act" onClick={() => onNavigate('cash')} type="button">Open forecast</button>}>
          <CashLine weeks={cash.weeks} opening={cash.opening} facility={cash.facility} height={210} />
        </Card>

        <Card span="c5" icon="chart" tone={over.length ? 'neg' : 'pos'} title="Spend against plan" subtitle={`year to date, ${data.fiscal.closingPeriodLabel}`} flush
          action={<button className="act" onClick={() => onNavigate('budgets')} type="button">View all</button>}>
          <div style={{ paddingTop: 10 }}>
            <VarianceBars
              rows={budgets.slice(0, 6).map((b) => ({ ...b, label: b.name, sub: `${unitName(data, b.companyCode)}, ${b.owner}` }))}
              onPick={(id) => onNavigate('budgets', id)}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
