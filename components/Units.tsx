"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/format";
import { convert, digitsFor, formatRange, type Quantity, type UnitSystem, unitOf } from "@/lib/measure";
import { api } from "./useLive";

interface UnitsContext {
  system: UnitSystem;
  /** Saves the choice in Settings and switches every page at once. */
  setSystem: (system: UnitSystem) => Promise<void>;
  /** "39.2 m" or "129 ft"; "–" for a missing value. */
  show: (quantity: Quantity, metric: number | null | undefined, metricDigits?: number) => string;
  /** "1–35 m", "to 35 m" or "98–115 ft": the unit once; null when neither end is known. */
  range: (quantity: Quantity, min: number | null | undefined, max: number | null | undefined) => string | null;
  /** The number alone, converted (for charts). */
  value: (quantity: Quantity, metric: number) => number;
  unit: (quantity: Quantity) => string;
}

const Context = createContext<UnitsContext | null>(null);

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [system, setLocal] = useState<UnitSystem>("metric");

  useEffect(() => {
    fetch("/api/settings/units", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body?.units && setLocal(body.units))
      .catch(() => undefined);
  }, []);

  const setSystem = useCallback(async (next: UnitSystem) => {
    await api("/api/settings", "PUT", { units: next });
    setLocal(next);
  }, []);

  const context = useMemo<UnitsContext>(
    () => ({
      system,
      setSystem,
      show: (quantity, metric, metricDigits) =>
        metric === null || metric === undefined ? "–" : formatNumber(convert(quantity, metric, system), digitsFor(quantity, system, metricDigits), unitOf(quantity, system)),
      range: (quantity, min, max) => formatRange(quantity, min, max, system, (v, digits) => formatNumber(v, digits)),
      value: (quantity, metric) => convert(quantity, metric, system),
      unit: (quantity) => unitOf(quantity, system),
    }),
    [system, setSystem],
  );
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useUnits(): UnitsContext {
  const context = useContext(Context);
  if (!context) throw new Error("useUnits needs the UnitsProvider (app/layout.tsx).");
  return context;
}
