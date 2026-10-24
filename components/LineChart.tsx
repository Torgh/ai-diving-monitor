"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";

export interface Series {
  key: string;
  label: string;
  /** A CSS colour, normally a series token: var(--series-1). */
  color: string;
  values: (number | null)[];
  /** Thinner and quieter, for a trend line beside the data. */
  muted?: boolean;
  /** Draw a dot at every value (for one value per dive). */
  dots?: boolean;
}

export interface ChartProps {
  /** Names the chart for screen readers and the table view. */
  title: string;
  x: number[];
  series: Series[];
  formatX: (x: number) => string;
  formatY: (y: number) => string;
  /** The x-axis label's unit, e.g. "min" or "dive". */
  xUnit: string;
  height?: number;
  /** Depth grows downwards. */
  invertY?: boolean;
  /** Always include these values in the y range (e.g. 0). */
  includeY?: number[];
  /** Horizontal reference lines, e.g. the ppO2 limits; their short labels sit in the right margin. */
  refLines?: { y: number; label: string }[];
  /** Fixed x tick positions (e.g. whole dive numbers) instead of round values. */
  xTicks?: number[];
  /** Keep the right margin for reference labels even without any, so stacked charts share one time axis. */
  labelMargin?: boolean;
  /** Highlighted x ranges, e.g. fast ascents, in a status colour, always with a label. */
  bands?: { from: number; to: number; label: string; color: string }[];
  /** Vertical events, e.g. gas switches. */
  markers?: { x: number; label: string }[];
  /** The hovered index, when several charts share one crosshair. */
  hover?: number | null;
  onHover?: (index: number | null) => void;
  /** Extra lines in the tooltip (values not plotted on this chart). */
  extraRows?: (index: number) => { label: string; value: string }[];
  /** At most this many rows in the table view (evenly spaced). */
  tableRows?: number;
}

const PAD = { top: 12, right: 16, bottom: 26, left: 44 };
/** Room in the right margin for reference-line labels, so they never sit on the data. */
const REF_LABEL_W = 64;

/** About `count` round tick values, from one at or below `min` to one at or above `max`. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  const last = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.floor(min / step + 1e-9) * step; v <= last + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** The index of the x value nearest to `value` (x sorted ascending). */
export function nearestIndex(x: number[], value: number): number {
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] < value) lo = mid;
    else hi = mid;
  }
  return Math.abs(x[lo] - value) <= Math.abs(x[hi] - value) ? lo : hi;
}

export function LineChart(props: ChartProps) {
  const { title, x, series, formatX, formatY, xUnit, height = 200, invertY, includeY = [], refLines = [], bands = [], markers = [] } = props;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [ownHover, setOwnHover] = useState<number | null>(null);
  const hover = props.onHover ? (props.hover ?? null) : ownHover;
  const setHover = props.onHover ?? setOwnHover;
  const tableId = useId();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const right = PAD.right + (refLines.length || props.labelMargin ? REF_LABEL_W : 0);
  const { xs, ys, yTicks, xTicks } = useMemo(() => {
    const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const all = [...values, ...includeY, ...refLines.map((r) => r.y)];
    let lo = all.length ? Math.min(...all) : 0;
    let hi = all.length ? Math.max(...all) : 1;
    if (hi === lo) [lo, hi] = [lo - 1, hi + 1];
    const ticks = niceTicks(lo, hi);
    lo = Math.min(lo, ticks[0]);
    hi = Math.max(hi, ticks[ticks.length - 1]);
    const x0 = x[0] ?? 0;
    const x1 = x.length > 1 ? x[x.length - 1] : x0 + 1;
    const innerW = width - PAD.left - right;
    const innerH = height - PAD.top - PAD.bottom;
    const sx = (v: number) => PAD.left + ((v - x0) / (x1 - x0 || 1)) * innerW;
    const sy = (v: number) => PAD.top + (invertY ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)) * innerH;
    const xTicks = props.xTicks ?? niceTicks(x0, x1, Math.max(2, Math.floor(innerW / 90))).filter((t) => t >= x0 && t <= x1);
    return { xs: sx, ys: sy, yTicks: ticks, xTicks };
  }, [series, includeY, refLines, x, width, height, invertY, right, props.xTicks]);

  // Reference labels in the margin, pushed apart when two limits are close (ppO2 1.4 and 1.6).
  const refLabelY: number[] = [];
  [...refLines]
    .map((r, i) => ({ i, y: ys(r.y) }))
    .sort((a, b) => a.y - b.y)
    .forEach((r, k, all) => {
      refLabelY[r.i] = k ? Math.max(r.y, refLabelY[all[k - 1].i] + 13) : r.y;
    });

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${xs(x[i]).toFixed(1)},${ys(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !x.length) return;
    const x0 = x[0];
    const x1 = x[x.length - 1];
    const ratio = (clientX - rect.left - PAD.left) / (rect.width - PAD.left - right);
    setHover(nearestIndex(x, x0 + ratio * (x1 - x0)));
  };

  const onKey = (e: KeyboardEvent) => {
    if (!x.length) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight") setHover(Math.min(x.length - 1, (hover ?? -1) + step));
    else if (e.key === "ArrowLeft") setHover(Math.max(0, (hover ?? x.length) - step));
    else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(x.length - 1);
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  const rows = (i: number) => [
    ...series.flatMap((s) => (s.values[i] === null ? [] : [{ label: s.label, value: formatY(s.values[i]!), color: s.color }])),
    ...(props.extraRows?.(i) ?? []).map((r) => ({ ...r, color: null as string | null })),
  ];

  const tableStep = Math.max(1, Math.ceil(x.length / (props.tableRows ?? 120)));
  const innerBottom = height - PAD.bottom;
  const hx = hover !== null && x[hover] !== undefined ? xs(x[hover]) : null;

  return (
    <div className="chart" ref={box}>
      {series.length >= 2 && (
        <div className="legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.key}>
              <span className="key" style={{ background: s.color, height: s.muted ? 1 : 2 }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${title}. Use the arrow keys to read values; the table below lists them.`}
        aria-describedby={tableId}
        tabIndex={0}
        onPointerMove={(e: PointerEvent) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={width - right} y1={ys(t)} y2={ys(t)} stroke="var(--grid)" strokeWidth={1} />
            <text className="tick" x={PAD.left - 6} y={ys(t)} dy="0.32em" textAnchor="end">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} className="tick" x={xs(t)} y={innerBottom + 16} textAnchor="middle">
            {formatX(t)}
          </text>
        ))}
        {bands.map((b, i) => (
          <g key={`b${i}`}>
            <rect x={xs(b.from)} y={PAD.top} width={Math.max(2, xs(b.to) - xs(b.from))} height={innerBottom - PAD.top} fill={b.color} opacity={0.14} />
            <rect x={xs(b.from)} y={PAD.top} width={Math.max(2, xs(b.to) - xs(b.from))} height={3} fill={b.color} />
            {i === 0 || xs(b.from) - xs(bands[i - 1].to) > 70 ? (
              // Near the right edge the label ends at the band instead of running off the chart.
              xs(b.from) + 80 > width - right ? (
                <text className="band-label" x={xs(b.to)} y={PAD.top + 14} textAnchor="end">
                  {b.label}
                </text>
              ) : (
                <text className="band-label" x={xs(b.from)} y={PAD.top + 14}>
                  {b.label}
                </text>
              )
            ) : null}
          </g>
        ))}
        {refLines.map((r, i) => (
          <g key={`r${r.y}`}>
            <line x1={PAD.left} x2={width - right} y1={ys(r.y)} y2={ys(r.y)} stroke="var(--axis)" strokeWidth={1} />
            <text className="ref-label" x={width - right + 6} y={refLabelY[i]} dy="0.32em">
              {r.label}
            </text>
          </g>
        ))}
        {markers.map((m, i) => (
          <g key={`m${i}`}>
            <line x1={xs(m.x)} x2={xs(m.x)} y1={PAD.top} y2={innerBottom} stroke="var(--axis)" strokeWidth={1} />
            <text className="marker-label" x={xs(m.x) + 4} y={innerBottom - 6}>
              {m.label}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - right} y1={innerBottom} y2={innerBottom} stroke="var(--axis)" strokeWidth={1} />
        {series.map((s, i) => (
          <path
            key={s.key}
            d={paths[i]}
            fill="none"
            stroke={s.color}
            strokeWidth={s.muted ? 1 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={s.muted ? 0.8 : 1}
          />
        ))}
        {series.map((s) =>
          s.dots
            ? s.values.map((v, i) =>
                v === null ? null : (
                  <circle key={`${s.key}${i}`} cx={xs(x[i])} cy={ys(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                ),
              )
            : null,
        )}
        {hx !== null && hover !== null && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={PAD.top} y2={innerBottom} stroke="var(--fg-2)" strokeWidth={1} />
            {series.map((s) =>
              s.values[hover] === null || s.muted ? null : (
                <circle key={`h${s.key}`} cx={hx} cy={ys(s.values[hover]!)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ),
            )}
          </g>
        )}
      </svg>
      {hx !== null && hover !== null && (
        <div className="tooltip" style={{ left: Math.min(hx + 12, width - 170), top: PAD.top }}>
          <div className="head">{formatX(x[hover])}</div>
          {rows(hover).map((r) => (
            <div className="row" key={r.label}>
              {r.color ? <span className="legend"><span className="key" style={{ background: r.color }} /></span> : null}
              <strong>{r.value}</strong>
              <span className="secondary">{r.label}</span>
            </div>
          ))}
        </div>
      )}
      <details className="table-view" id={tableId}>
        <summary>Table: {title}</summary>
        <div className="table-scroll">
          <table className="log">
            <thead>
              <tr>
                <th>{xUnit}</th>
                {series.map((s) => (
                  <th key={s.key} className="num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {x.map((xv, i) =>
                i % tableStep === 0 || i === x.length - 1 ? (
                  <tr key={i}>
                    <td>{formatX(xv)}</td>
                    {series.map((s) => (
                      <td key={s.key} className="num">
                        {s.values[i] === null ? "–" : formatY(s.values[i]!)}
                      </td>
                    ))}
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
