"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";
import type { DiveView } from "@/lib/views";
import { LineChart } from "./LineChart";

const minutes = (v: number) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`;

/**
 * The depth profile and, under it, one small chart per other measurement (tank pressure, ppO2,
 * temperature). Each has its own axis; they share the time axis and one crosshair.
 */
export function ProfileCharts({ view }: { view: DiveView }) {
  const [hover, setHover] = useState<number | null>(null);
  const { profile } = view;
  const x = profile.map((p) => p.tMin);
  const has = (key: "tankBar" | "ppo2" | "tempC" | "ceilingM") => profile.some((p) => p[key] !== null);
  const shared = { x, formatX: minutes, xUnit: "Time (min)", hover, onHover: setHover, labelMargin: true };
  const ascent = (i: number) => [{ label: "ascent rate", value: `${formatNumber(Math.max(0, profile[i].ascentMMin), 1)} m/min` }];

  if (!profile.length) return <p className="muted">The dive computer recorded no profile for this dive.</p>;
  return (
    <div className="stack">
      <div>
        <h3>Depth</h3>
        <LineChart
          {...shared}
          title="Depth profile"
          invertY
          includeY={[0]}
          height={260}
          formatY={(v) => `${formatNumber(v, 1)} m`}
          series={[
            { key: "depth", label: "Depth", color: "var(--series-1)", values: profile.map((p) => p.depthM) },
            ...(has("ceilingM") ? [{ key: "ceiling", label: "Deco stop (computer)", color: "var(--series-2)", values: profile.map((p) => p.ceilingM) }] : []),
          ]}
          bands={view.fastAscents.map((a) => ({ from: a.fromMin, to: a.toMin, label: "⚠ Fast ascent", color: "var(--serious)" }))}
          markers={view.gasSwitches.map((g) => ({ x: g.tMin, label: `→ ${g.gas}` }))}
          extraRows={ascent}
        />
      </div>
      {has("tankBar") && (
        <div>
          <h3>Tank pressure</h3>
          <LineChart {...shared} title="Tank pressure" height={140} formatY={(v) => `${formatNumber(v, 0)} bar`} includeY={[0]} series={[{ key: "tank", label: "Tank pressure", color: "var(--series-1)", values: profile.map((p) => p.tankBar) }]} />
        </div>
      )}
      {has("ppo2") && (
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
      {has("tempC") && (
        <div>
          <h3>Water temperature</h3>
          <LineChart {...shared} title="Water temperature" height={120} formatY={(v) => `${formatNumber(v, 1)} °C`} series={[{ key: "temp", label: "Temperature", color: "var(--series-1)", values: profile.map((p) => p.tempC) }]} />
        </div>
      )}
    </div>
  );
}
