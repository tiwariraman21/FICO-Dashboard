// Budgets: cost centre spend against plan, year to date, with where each is heading.

import { useEffect, useState } from 'react';
import { inr, pct } from '../format.js';
import { Card, Chip, Tile } from '../components/ui.jsx';
import { VarianceBars, PlanActual } from '../components/finance-charts.jsx';
import { byUnit, sum, unitName } from '../selectors.js';

export default function Budgets({ data, unit, focus, onNavigate }) {
  const rows = byUnit(data.budgets, unit);
  const [picked, setPicked] = useState(focus || rows[0]?.id);
  useEffect(() => {
    if (focus) setPicked(focus);
  }, [focus]);
  const b = rows.find((r) => r.id === picked) || rows[0];

  const plan = sum(rows, 'ytdPlan');
  const actual = sum(rows, 'ytdActual');
  const over = rows.filter((r) => r.status === 'over');
  const months = data.fiscal.periods;

  return (
    <>
      <div className="tiles">
        <Tile icon="chart" label="Plan to date" value={inr(plan)} sub={`April to ${data.fiscal.closingPeriodLabel}`} tone="mut" footer={`${rows.length} cost centres`} />
        <Tile icon="chart" label="Actual to date" value={inr(actual)} sub={pct(((actual - plan) / plan) * 100)} tone={actual > plan ? 'warn' : 'pos'} footer={`${inr(actual - plan)} ${actual > plan ? 'over' : 'under'} plan`} />
        <Tile icon="alert" label="Running over" value={over.length} sub="more than 8% above plan" tone={over.length ? 'neg' : 'pos'} footer={over.length ? `${inr(sum(over, 'variance'))} over between them` : 'none'} />
        <Tile icon="up" label="Full-year estimate" value={inr(sum(rows, 'forecast'))} sub={`budget ${inr(sum(rows, 'annualPlan'))}`} tone={sum(rows, 'forecast') > sum(rows, 'annualPlan') ? 'warn' : 'pos'} footer="at each cost centre's current rate" />
      </div>

      <div className="split">
        <Card icon="chart" tone={over.length ? 'neg' : 'pri'} title="Spend against plan, year to date" subtitle="red more than 8% over, amber 3–8% over, grey within plan, blue more than 15% under; click one for its months" flush>
          <div style={{ paddingTop: 10 }}>
            <VarianceBars rows={rows.map((r) => ({ ...r, label: r.name, sub: `${r.id} · ${r.owner}` }))} picked={b?.id} onPick={setPicked} />
          </div>
        </Card>

        {b && (
          <div className="sticky">
            <Card icon="chart" tone={b.tone} title={`${b.name}, ${unitName(data, b.companyCode)}`} subtitle={`${b.id} · owner ${b.owner}`}>
              <PlanActual months={months} plan={b.monthlyPlan} actual={b.monthlyActual} height={180} />
              <dl className="kvlist" style={{ marginTop: 12 }}>
                <dt>Plan to date</dt><dd className="n">{inr(b.ytdPlan)}</dd>
                <dt>Actual to date</dt><dd className="n">{inr(b.ytdActual)}</dd>
                <dt>Difference</dt><dd className="n" style={{ color: b.variance > 0 ? 'var(--neg)' : 'var(--primary)' }}>{inr(b.variance)} ({pct(b.variancePercent)})</dd>
                <dt>{data.fiscal.closingPeriodLabel.split(' ')[0]} alone</dt><dd className="n">{pct(b.lastMonthPercent)}</dd>
                <dt>Open commitments</dt><dd className="n">{inr(b.committed)}</dd>
                <dt>Annual budget</dt><dd className="n">{inr(b.annualPlan)}</dd>
                <dt>Full-year estimate</dt><dd className="n">{inr(b.forecast)}</dd>
                <dt>Left to spend</dt><dd className="n">{inr(b.remaining)}</dd>
                <dt>Standing</dt><dd><Chip tone={b.tone}>{b.status}</Chip></dd>
              </dl>
              {b.status === 'over' && (
                <button className="btn emph" type="button" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }} onClick={() => onNavigate('problems')}>
                  Ask {b.owner.replace(/^(Mr|Ms|Mrs)\.\s*/, '').split(' ')[0]} for a variance note
                </button>
              )}
            </Card>
          </div>
        )}
      </div>
      <p className="footnote">Year to date is compared with the plan for the same months, not a twelfth of the annual budget, because cement sells less in the monsoon. The full-year estimate assumes each cost centre carries on at its current rate against plan.</p>
    </>
  );
}
