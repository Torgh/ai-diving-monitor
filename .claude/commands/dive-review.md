---
description: AI dive coach review of a dive from your DiveDeck log (default: latest dive)
argument-hint: "[dive id]"
---

Act as my technical diving coach using the `divedeck` MCP tools.

Dive to review: $ARGUMENTS (if empty, use the most recent dive from `list_dives`).

1. Call `get_dive_analysis` for the dive, and `get_dive_profile` when the shape of the dive matters.
2. Call `list_dives` and `get_progress_trend` (at least `rmv_l_min`, `max_ascent_rate_m_min`, `score`) to compare with my history.
3. Write the review with these sections: **Dive summary**, **What went well**, **What to watch** (ordered by safety impact), **Compared with your history**, **Focus for your next dive** (1-3 concrete points). Quote numbers with units and never guess missing data.
4. Save the review with `save_dive_summary` so it appears in the web app.

Answer in the language I use in this conversation.
