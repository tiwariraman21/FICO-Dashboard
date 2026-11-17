// Cost centre spend against plan.
//
// Year to date is compared with the plan for the same months, not with a twelfth of the
// annual figure, because cement is seasonal and the monsoon months plan for less.
//
// The full-year estimate is deliberately simple: if a cost centre has run at 112 percent of
// plan so far, it is assumed to keep doing so. That is the question a Controller asks first,
// and anything cleverer belongs in the planning tool.

import { round, sum } from './format.js';

export function assessBudgets({ costCentres, fiscal }) {
  const closed = fiscal.closingPeriod; // periods with actuals

  return costCentres
    .map((c) => {
      const ytdPlan = sum(c.monthlyPlan.slice(0, closed), (v) => v);
      const ytdActual = sum(c.monthlyActual.slice(0, closed), (v) => v);
      const variance = ytdActual - ytdPlan;
      const variancePercent = ytdPlan ? round((variance / ytdPlan) * 100, 1) : 0;
      const runRate = ytdPlan ? ytdActual / ytdPlan : 1;
      const forecast = Math.round(c.annualPlan * runRate);
      const lastMonthPlan = c.monthlyPlan[closed - 1];
      const lastMonthActual = c.monthlyActual[closed - 1];
      const lastMonthPercent = lastMonthPlan ? round(((lastMonthActual - lastMonthPlan) / lastMonthPlan) * 100, 1) : 0;

      let status = 'on plan';
      if (variancePercent > 8) status = 'over';
      else if (variancePercent > 3) status = 'watch';
      else if (variancePercent < -15) status = 'under';

      return {
        ...c,
        ytdPlan,
        ytdActual,
        variance,
        variancePercent,
        forecast,
        forecastOver: forecast - c.annualPlan,
        remaining: c.annualPlan - ytdActual - c.committed,
        lastMonthPercent,
        status,
        tone: status === 'over' ? 'neg' : status === 'watch' ? 'warn' : status === 'under' ? 'pri' : 'pos'
      };
    })
    .sort((a, b) => b.variancePercent - a.variancePercent);
}
