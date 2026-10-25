/** How a trip gets here: the coach copies it from TripDeck. */
export function TripPrepHint({ trip }: { trip?: string }) {
  return (
    <p className="muted">
      {trip ? "Ask your coach" : "Plan the trip in TripDeck, then ask your coach"} in Claude Code or Codex, with TripDeck&apos;s MCP server
      connected too: <code>/mcp__ai-diving-monitor__trip-prep {trip ?? "<trip name>"}</code>.
      {trip ? " Run it again after changing the trip in TripDeck." : " The trip and the preparation for each dive appear here."}
    </p>
  );
}
