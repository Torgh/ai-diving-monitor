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

/** "8–15 May 2027", "28 Apr – 3 May 2027", "8 May 2027", or "No dates". */
export function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return "No dates";
  if (!end || end === start) return formatDate(start, false);
  const [a, b] = [formatDate(start, false).split(" "), formatDate(end, false).split(" ")];
  if (a[2] !== b[2]) return `${a.join(" ")} – ${b.join(" ")}`;
  if (a[1] !== b[1]) return `${a[0]} ${a[1]} – ${b.join(" ")}`;
  return `${a[0]}–${b.join(" ")}`;
}

/** When a trip is, from today: "in 12 days", "tomorrow", "under way", "ended 3 days ago". */
export function formatTripWhen(trip: { when: "upcoming" | "now" | "past" | "undated"; daysUntil: number | null; endDate: string | null }, today = new Date()): string {
  if (trip.when === "undated" || trip.daysUntil === null) return "No dates yet";
  if (trip.when === "now") return "Under way";
  if (trip.when === "upcoming") return trip.daysUntil === 1 ? "Tomorrow" : `In ${trip.daysUntil} days`;
  const end = trip.endDate ? Math.round((today.getTime() - Date.parse(`${trip.endDate}T00:00:00Z`)) / 86_400_000) : null;
  return end !== null && end > 0 ? `Ended ${end === 1 ? "yesterday" : `${end} days ago`}` : "Ended";
}
