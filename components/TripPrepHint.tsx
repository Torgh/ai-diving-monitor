import { Command } from "./Command";

/** How a trip gets here: your companion copies it from TripDeck. */
export function TripPrepHint({ trip }: { trip?: string }) {
  return (
    <p className="muted">
      {trip ? "Ask your companion" : "Plan the trip in TripDeck, then ask your companion"} in Claude Code or Codex, with TripDeck&apos;s MCP server
      connected too: <Command text={`/mcp__divedeck__trip-prep ${trip ?? "<trip name>"}`} />.
      {trip ? " Run it again after changing the trip in TripDeck." : " The trip and the preparation for each dive appear here."}
    </p>
  );
}
