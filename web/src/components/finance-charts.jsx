// The finance charts, drawn by hand as SVG. No chart library.
//
// Each chart measures its own width and draws in real pixels, so text is never stretched.
// Every chart has a hover layer: a tooltip on each bar, or a crosshair on a line. Colours
// come from CSS variables (see fico.css), so light and dark themes each get their own
// validated steps rather than an automatic flip.
//
// Rules kept throughout: one y-axis per chart, thin marks with rounded data ends, a 2px gap
// between adjacent fills, legends whenever there are two or more series, and text in ink
// colours rather than series colours.

import { useEffect, useRef, useState } from 'react';
import { inr } from '../format.js';

function useWidth(fallback = 600) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// A tooltip that follows the pointer within the chart box.
function useTip() {
  const [tip, setTip] = useState(null);
  const show = (event, content) => {
    const box = event.currentTarget.closest('.fchart').getBoundingClientRect();
    setTip({ x: event.clientX - box.left, y: event.clientY - box.top, content, width: box.width });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div
      className="ftip"
      style={{ left: Math.min(tip.x + 14, tip.width - 220), top: Math.max(0, tip.y - 12) }}
      role="status"
    >
      {tip.content}
    </div>
  ) : null;
  return { show, hide, node };
}

// Nice round ticks for a money axis.
function ticks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MON[m - 1]}`;
}

function axisMoney(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 10000000) return `${s}${+(a / 10000000).toFixed(1)} cr`;
  if (a >= 100000) return `${s}${Math.round(a / 100000)} L`;
  return `${s}${Math.round(a / 1000)} k`;
}

// A bar with rounded data end only, anchored square to its baseline.
function barPath(x, y, w, h, r = 4) {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + rr}Q${x} ${y} ${x + rr} ${y}H${x + w - rr}Q${x + w} ${y} ${x + w} ${y + rr}V${y + h}Z`;
}
function barPathDown(x, y, w, h, r = 4) {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y}H${x + w}V${y + h - rr}Q${x + w} ${y + h} ${x + w - rr} ${y + h}H${x + rr}Q${x} ${y + h} ${x} ${y + h - rr}Z`;
}

// --- Ageing: one stacked bar, read left (not due) to right (oldest) --------------------------

export const AGE_BUCKETS = [
  { key: 'notDue', label: 'Not yet due', colour: 'var(--age-0)' },
  { key: 'd1_30', label: '1–30 days', colour: 'var(--age-1)' },
  { key: 'd31_60', label: '31–60 days', colour: 'var(--age-2)' },
  { key: 'd61_90', label: '61–90 days', colour: 'var(--age-3)' },
  { key: 'd90', label: 'Over 90 days', colour: 'var(--age-4)' }
];

export function AgeingBar({ buckets, onPick, picked }) {
  const total = AGE_BUCKETS.reduce((s, b) => s + (buckets[b.key] || 0), 0);
  const tip = useTip();
  if (!total) return <p className="muted">Nothing outstanding.</p>;
  return (
    <div className="fchart">
      <div className="agebar" onMouseLeave={tip.hide}>
        {AGE_BUCKETS.filter((b) => buckets[b.key] > 0).map((b) => (
          <button
            type="button"
            key={b.key}
            className={`ageseg${picked === b.key ? ' on' : ''}`}
            style={{ flexGrow: buckets[b.key], background: b.colour }}
            onMouseMove={(e) => tip.show(e, <><b>{b.label}</b><br />{inr(buckets[b.key])}, {Math.round((buckets[b.key] / total) * 100)}% of the total</>)}
            onClick={() => onPick && onPick(picked === b.key ? null : b.key)}
            aria-label={`${b.label}: ${inr(buckets[b.key])}`}
          />
        ))}
      </div>
      <div className="agelegend">
        {AGE_BUCKETS.map((b) => (
          <button type="button" key={b.key} className={`agekey${picked === b.key ? ' on' : ''}`} onClick={() => onPick && onPick(picked === b.key ? null : b.key)}>
            <span className="sw" style={{ background: b.colour }} />
            <span className="kl">{b.label}</span>
            <span className="kv n">{inr(buckets[b.key] || 0)}</span>
          </button>
        ))}
      </div>
      {tip.node}
    </div>
  );
}

// --- Cash: closing balance week by week, with the facility floor ------------------------------

export function CashLine({ weeks, opening, facility, height = 220 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 56, r: 16, t: 14, b: 28 };
  const points = [{ label: 'Today', closing: opening, inflow: 0, outflow: 0 }, ...weeks];
  const values = points.map((p) => p.closing);
  const floor = facility > 0 ? -facility : null;
  let min = Math.min(0, ...values, floor ?? 0);
  let max = Math.max(0, ...values);
  const span = max - min || 1;
  min -= span * 0.08;
  max += span * 0.08;
  const t = ticks(min, max);
  min = Math.min(min, t[0]);
  max = Math.max(max, t[t.length - 1]);
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (i) => pad.l + (i / (points.length - 1)) * iw;
  const y = (v) => pad.t + (1 - (v - min) / (max - min)) * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.closing).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;

  function onMove(e) {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left - pad.l) / iw) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="fchart" ref={ref}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Closing bank balance by week">
        {t.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'fzero' : 'fgrid'} />
            <text x={pad.l - 8} y={y(v) + 4} className="fax" textAnchor="end">{axisMoney(v)}</text>
          </g>
        ))}
        {floor !== null && (
          <g>
            <line x1={pad.l} x2={width - pad.r} y1={y(floor)} y2={y(floor)} className="ffloor" />
            <text x={width - pad.r} y={y(floor) - 6} className="fax" textAnchor="end">cash credit limit</text>
          </g>
        )}
        <path d={area} className="farea" />
        <path d={line} className="fline" />
        {points.map((p, i) => (
          <text key={i} x={x(i)} y={height - 8} className="fax" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
            {i === 0 ? 'Today' : width < 520 && i % 2 ? '' : shortDate(p.end)}
          </text>
        ))}
        {points.map((p, i) => (
          <circle key={`d${i}`} cx={x(i)} cy={y(p.closing)} r={hover === i ? 5 : 3.5} className={floor !== null && p.closing < floor ? 'fdot bad' : 'fdot'} />
        ))}
        {h && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="fcross" />}
      </svg>
      {h && (
        <div className="ftip" style={{ left: Math.min(x(hover) + 12, width - 220), top: 8 }}>
          <b>{hover === 0 ? 'Today' : `Week of ${h.label}, closing ${shortDate(h.end)}`}</b>
          {hover > 0 && (
            <>
              <div className="trow2"><span>Money in</span><span className="n">{inr(h.inflow)}</span></div>
              <div className="trow2"><span>Money out</span><span className="n">{inr(h.outflow)}</span></div>
            </>
          )}
          <div className="trow2"><span>{hover === 0 ? 'Bank balance' : 'Closing balance'}</span><span className="n"><b>{inr(h.closing)}</b></span></div>
          {facility > 0 && <div className="trow2"><span>Headroom incl. cash credit</span><span className="n">{inr(h.closing + facility)}</span></div>}
        </div>
      )}
    </div>
  );
}

// --- Two series by month: grouped bars --------------------------------------------------------

export function PairBars({ rows, aLabel, bLabel, height = 200 }) {
  const [ref, width] = useWidth();
  const tip = useTip();
  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  const t = ticks(0, max);
  const top = t[t.length - 1];
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const group = iw / rows.length;
  const bw = Math.max(4, Math.min(22, (group - 14) / 2));
  const y = (v) => pad.t + (1 - v / top) * ih;

  return (
    <div className="fchart" ref={ref}>
      <div className="flegend">
        <span><i style={{ background: 'var(--s1)' }} />{aLabel}</span>
        <span><i style={{ background: 'var(--s2)' }} />{bLabel}</span>
      </div>
      <svg width={width} height={height} onMouseLeave={tip.hide} role="img" aria-label={`${aLabel} and ${bLabel} by month`}>
        {t.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'fzero' : 'fgrid'} />
            <text x={pad.l - 8} y={y(v) + 4} className="fax" textAnchor="end">{axisMoney(v)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = pad.l + group * i + group / 2;
          return (
            <g key={r.label} onMouseMove={(e) => tip.show(e, <><b>{r.label}</b><div className="trow2"><span>{aLabel}</span><span className="n">{inr(r.a)}</span></div><div className="trow2"><span>{bLabel}</span><span className="n">{inr(r.b)}</span></div></>)}>
              <rect x={cx - group / 2} y={pad.t} width={group} height={ih} fill="transparent" />
              <path d={barPath(cx - bw - 1, y(r.a), bw, y(0) - y(r.a))} fill="var(--s1)" />
              <path d={barPath(cx + 1, y(r.b), bw, y(0) - y(r.b))} fill="var(--s2)" />
              <text x={cx} y={height - 8} className="fax" textAnchor="middle">{r.label}</text>
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

// --- Variance: diverging bars around plan ---------------------------------------------------

export function VarianceBars({ rows, onPick, picked }) {
  const tip = useTip();
  const limit = Math.max(10, ...rows.map((r) => Math.abs(r.variancePercent)));
  return (
    <div className="fchart vbars" onMouseLeave={tip.hide}>
      <div className="vhead">
        <span />
        <span className="vaxis"><span>under plan</span><span>over plan</span></span>
        <span />
      </div>
      {rows.map((r) => {
        const w = (Math.abs(r.variancePercent) / limit) * 50;
        const over = r.variancePercent > 0;
        return (
          <button
            type="button"
            key={r.id}
            className={`vrow${picked === r.id ? ' on' : ''}`}
            onClick={() => onPick && onPick(r.id)}
            onMouseMove={(e) => tip.show(e, <><b>{r.label}</b><div className="trow2"><span>Plan to date</span><span className="n">{inr(r.ytdPlan)}</span></div><div className="trow2"><span>Actual to date</span><span className="n">{inr(r.ytdActual)}</span></div><div className="trow2"><span>Difference</span><span className="n">{inr(r.variance)}</span></div></>)}
          >
            <span className="vl">{r.label}<small>{r.sub}</small></span>
            <span className="vtrack">
              <span className="vmid" />
              <span
                className={`vbar ${r.status === 'over' ? 'over' : r.status === 'watch' ? 'watch' : r.status === 'under' ? 'under' : over ? 'ok up' : 'ok'}`}
                style={over ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
              />
            </span>
            <span className={`vv n ${r.status === 'over' ? 'neg' : r.status === 'watch' ? 'warn' : ''}`}>
              {r.variancePercent > 0 ? '+' : ''}{r.variancePercent.toFixed(1)}%
            </span>
          </button>
        );
      })}
      {tip.node}
    </div>
  );
}

// --- Plan against actual, by month, for one cost centre ---------------------------------------

export function PlanActual({ months, plan, actual, height = 190 }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 52, r: 12, t: 10, b: 26 };
  const max = Math.max(1, ...plan, ...actual);
  const t = ticks(0, max);
  const top = t[t.length - 1];
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (i) => pad.l + (i / (months.length - 1)) * iw;
  const y = (v) => pad.t + (1 - v / top) * ih;
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');

  return (
    <div className="fchart" ref={ref}>
      <div className="flegend">
        <span><i className="dash" />Plan</span>
        <span><i style={{ background: 'var(--s1)' }} />Actual</span>
      </div>
      <svg
        width={width}
        height={height}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - box.left - pad.l) / iw) * (months.length - 1));
          setHover(Math.max(0, Math.min(months.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Plan and actual spend by month"
      >
        {t.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'fzero' : 'fgrid'} />
            <text x={pad.l - 8} y={y(v) + 4} className="fax" textAnchor="end">{axisMoney(v)}</text>
          </g>
        ))}
        <path d={path(plan)} className="fplan" />
        <path d={path(actual)} className="fline" />
        {actual.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3.5} className="fdot" />)}
        {months.map((m, i) => <text key={m} x={x(i)} y={height - 8} className="fax" textAnchor="middle">{m}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="fcross" />}
      </svg>
      {hover !== null && (
        <div className="ftip" style={{ left: Math.min(x(hover) + 12, width - 220), top: 8 }}>
          <b>{months[hover]}</b>
          <div className="trow2"><span>Plan</span><span className="n">{inr(plan[hover])}</span></div>
          <div className="trow2"><span>Actual</span><span className="n">{inr(actual[hover] ?? null)}</span></div>
        </div>
      )}
    </div>
  );
}

// --- Close progress: one bar, by status -------------------------------------------------------

export const TASK_STATES = [
  { key: 'done', label: 'Done', tone: 'pos' },
  { key: 'in progress', label: 'In progress', tone: 'pri' },
  { key: 'waiting', label: 'Waiting on approval', tone: 'warn' },
  { key: 'not started', label: 'Not started', tone: 'mut' },
  { key: 'blocked', label: 'Blocked', tone: 'neg' }
];

export function CloseBar({ tasks }) {
  const tip = useTip();
  const total = tasks.length || 1;
  return (
    <div className="fchart">
      <div className="closebar" onMouseLeave={tip.hide}>
        {TASK_STATES.map((s) => {
          const n = tasks.filter((t) => t.status === s.key).length;
          if (!n) return null;
          return (
            <span
              key={s.key}
              className={`cseg t-${s.tone}`}
              style={{ flexGrow: n }}
              onMouseMove={(e) => tip.show(e, <><b>{s.label}</b><br />{n} of {total} tasks</>)}
            />
          );
        })}
      </div>
      {tip.node}
    </div>
  );
}
