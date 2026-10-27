import { useState } from "react";
import { useUnits } from "@/components/Units";
import { api } from "@/components/useLive";
import type { GearKind, Kit, KitChange, Water } from "@/lib/kit";
import type { Part, RentalTank, WeightingEstimate } from "@/lib/weighting";

export type Data = Kit & {
  version: string;
  siteNames: string[];
  estimates: Record<string, Record<Water, WeightingEstimate>>;
  /** The same with a tank rented from the dive centre. */
  rentalEstimates: Record<string, Record<RentalTank, Record<Water, WeightingEstimate>>>;
};

/** Your own tank, or one rented from the dive centre. */
export type TankChoice = "own" | RentalTank;

export const KIND_LABEL: Record<GearKind, string> = {
  suit: "Suit",
  hood: "Hood",
  gloves: "Gloves",
  boots: "Boots",
  bcd: "BCD / wing",
  regulator: "Regulators",
  tank: "Tank",
  fins: "Fins",
  computer: "Computer",
  light: "Light",
  camera: "Camera",
  other: "Other",
};
export const WATER_LABEL: Record<Water, string> = { fresh: "Fresh", brackish: "Brackish", salt: "Salt" };
export const GROUPS: { title: string; kinds: GearKind[] }[] = [
  { title: "Exposure", kinds: ["suit", "hood", "gloves", "boots"] },
  { title: "BCD, tank, breathing", kinds: ["bcd", "tank", "regulator"] },
  { title: "Accessories", kinds: ["fins", "computer", "light", "camera", "other"] },
];

/** 24×24 stroke icons, one per kind of gear. */
const KIND_ICON: Record<GearKind, React.ReactNode> = {
  suit: <path d="M8 3h8l3 5-3 2v11H8V10L5 8z" />,
  hood: <path d="M6 12a6 6 0 0 1 12 0v6l-3 3H9l-3-3z" />,
  gloves: <path d="M8 21v-9l-2-3V5h2v4h1V3h2v6h1V3h2v6h1V5h2v8l-2 8z" />,
  boots: <path d="M7 3h5v11l7 3v4H7z" />,
  bcd: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="3" />
      <path d="M4 8c0 6 1 9 3 10M20 8c0 6-1 9-3 10" />
    </>
  ),
  regulator: (
    <>
      <circle cx="9" cy="10" r="5" />
      <path d="M14 10h4l2 3M9 15v5" />
    </>
  ),
  tank: (
    <>
      <rect x="8" y="5" width="8" height="16" rx="3" />
      <path d="M10 5V3h4v2" />
    </>
  ),
  fins: <path d="M9 3h6l2 18H7z" />,
  computer: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 6V3h6v3M9 18v3h6v-3" />
    </>
  ),
  light: <path d="M9 3h6v6l3 3v9H6v-9l3-3z" />,
  camera: (
    <>
      <rect x="3" y="7" width="13" height="11" rx="2" />
      <path d="M16 11l5-3v9l-5-3" />
    </>
  ),
  other: <path d="M3 9h18v5a3 3 0 0 1-3 3h-3l-3-3-3 3H6a3 3 0 0 1-3-3z" />,
};

export function KindIcon({ kind }: { kind: GearKind }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      {KIND_ICON[kind]}
    </svg>
  );
}

/** "" leaves a number out (and removes it when editing); a comma works as the decimal point. */
export const num = (text: string) => (text.trim() === "" ? null : Number(text.trim().replace(",", ".")));
export const str = (value: unknown) => (value === undefined || value === null ? "" : String(value));

export function useSave() {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(change: KitChange): Promise<Kit | null> {
    setBusy(true);
    setFailure(null);
    try {
      return await api<Kit>("/api/kit", "PUT", change);
    } catch (err) {
      setFailure((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, failure };
}

export function Failure({ text }: { text: string | null }) {
  return text ? (
    <span role="alert" style={{ color: "var(--critical)" }}>
      {text}
    </span>
  ) : null;
}

/** A buoyancy figure as a pill: blue floats, orange sinks, dashed when typical, amber when unknown. */
export function BuoyancyPill({ part }: { part: Part | undefined }) {
  const { show } = useUnits();
  if (!part) return null;
  if (part.status === "unknown") return <span className="pill unknown">? kg</span>;
  const sign = part.kg > 0 ? "+" : part.kg < 0 ? "−" : "";
  const tone = part.kg > 0 ? "floats" : part.kg < 0 ? "sinks" : "zero";
  return (
    <span className={`pill ${tone} ${part.status === "typical" ? "typical" : ""}`} title={part.why}>
      {part.status === "typical" ? "≈ " : ""}
      {sign}
      {show("weight", Math.abs(part.kg))}
    </span>
  );
}
