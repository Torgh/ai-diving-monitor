/** Display helpers shared by the pages (no Python compatibility needed here). */

export function formatDate(iso: string | null, withTime = true): string {
  if (!iso) return "Undated";
  const [date, time] = iso.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return withTime && time ? `${day}, ${time.slice(0, 5)}` : day;
}

/** "1 h 05 min" or "42 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

export function formatNumber(value: number | null | undefined, digits = 1, unit = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  const text = value.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return unit ? `${text} ${unit}` : text;
}

/** "3 min 20 s". */
export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m} min ${s} s` : `${s} s`;
}
