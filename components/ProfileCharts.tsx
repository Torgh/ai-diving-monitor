"use client";

import { useState, useSyncExternalStore } from "react";
import { formatNumber } from "@/lib/format";
import type { DiveView } from "@/lib/views";
import { LineChart } from "./LineChart";
import { useUnits } from "./Units";

/** A phone's width, where the charts become tabs (the same breakpoint as the tab bar). */
const NARROW = "(max-width: 760px)";
const subscribeNarrow = (onChange: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);

type ChartKey = "depth" | "tank" | "ppo2" | "temp";
const CHART_LABEL: Record<ChartKey, string> = { depth: "Depth", tank: "Tank", ppo2: "ppO2", temp: "Temp" };

const minutes = (v: number) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`;

/**
 * The depth profile and, under it, one small chart per other measurement (tank pressure, ppO2,
 * temperature). Each has its own axis; they share the time axis and one crosshair. On a phone they
 * are tabs, one chart at a time, so the page doesn't become a long scroll of charts.
 */
export function ProfileCharts({ view }: { view: DiveView }) {
  const [hover, setHover] = useState<number | null>(null);
  const [tab, setTab] = useState<ChartKey>("depth");
  const narrow = useNarrow();
  const { show, value, unit } = useUnits();
  // Values in the diver's units; a missing one stays missing.
  const to = (quantity: Parameters<typeof value>[0], v: number | null) => (v === null ? null : value(quantity, v));
  const { profile } = view;
  const x = profile.map((p) => p.tMin);
  const has = (key: "tankBar" | "ppo2" | "tempC" | "ceilingM") => profile.some((p) => p[key] !== null);
  const shared = { x, formatX: minutes, xUnit: "Time (min)", hover, onHover: setHover, labelMargin: true };
  const ascent = (i: number) => [{ label: "ascent rate", value: show("speed", Math.max(0, profile[i].ascentMMin)) }];

  if (!profile.length) return <p className="muted">The dive computer recorded no profile for this dive.</p>;
  const charts: ChartKey[] = ["depth", ...(has("tankBar") ? (["tank"] as const) : []), ...(has("ppo2") ? (["ppo2"] as const) : []), ...(has("tempC") ? (["temp"] as const) : [])];
  const showing = (key: ChartKey) => !narrow || (charts.includes(tab) ? tab : "depth") === key;
  return (
    <div className="stack">
      {narrow && charts.length > 1 && (
        <div className="tabs chart-tabs" role="tablist" aria-label="Charts">
          {charts.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={showing(key)} onClick={() => setTab(key)}>
              {CHART_LABEL[key]}
            </button>
          ))}
        </div>
      )}
      {showing("depth") && (
        <div>
          <h3>Depth</h3>
          <LineChart
            {...shared}
            title="Depth profile"
            invertY
            includeY={[0]}
            height={260}
            formatY={(v) => `${formatNumber(v, 1)} ${unit("depth")}`}
            series={[
              { key: "depth", label: "Depth", color: "var(--series-1)", values: profile.map((p) => value("depth", p.depthM)) },
              ...(has("ceilingM") ? [{ key: "ceiling", label: "Deco stop (computer)", color: "var(--series-2)", values: profile.map((p) => to("depth", p.ceilingM)) }] : []),
            ]}
            bands={view.fastAscents.map((a) => ({ from: a.fromMin, to: a.toMin, label: "⚠ Fast ascent", color: "var(--serious)" }))}
            markers={view.gasSwitches.map((g) => ({ x: g.tMin, label: `→ ${g.gas}` }))}
            extraRows={ascent}
          />
        </div>
      )}
      {has("tankBar") && showing("tank") && (
        <div>
          <h3>Tank pressure</h3>
          <LineChart {...shared} title="Tank pressure" height={140} formatY={(v) => `${formatNumber(v, 0)} ${unit("pressure")}`} includeY={[0]} series={[{ key: "tank", label: "Tank pressure", color: "var(--series-1)", values: profile.map((p) => to("pressure", p.tankBar)) }]} />
        </div>
      )}
      {has("ppo2") && showing("ppo2") && (
        <div>
          <h3>ppO2</h3>
          <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
            Lines: 1.4 bar working limit, 1.6 bar deco limit.
          </p>
          <LineChart
            {...shared}
            title="ppO2"
            height={140}
            formatY={(v) => `${formatNumber(v, 2)} bar`}
            includeY={[0]}
            refLines={[
              { y: 1.4, label: "1.4 work" },
              { y: 1.6, label: "1.6 deco" },
            ]}
            series={[{ key: "ppo2", label: "ppO2", color: "var(--series-1)", values: profile.map((p) => p.ppo2) }]}
          />
        </div>
      )}
      {has("tempC") && showing("temp") && (
        <div>
          <h3>Water temperature</h3>
          <LineChart {...shared} title="Water temperature" height={120} formatY={(v) => `${formatNumber(v, 1)} ${unit("temperature")}`} series={[{ key: "temp", label: "Temperature", color: "var(--series-1)", values: profile.map((p) => to("temperature", p.tempC)) }]} />
        </div>
      )}
    </div>
  );
}
