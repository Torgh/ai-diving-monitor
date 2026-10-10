# 🤿 AI Diving Monitor

**An AI dive coach for technical divers.** Import the logs from your dive computer, keep them all in one
local database, and get a clear, data-driven review of every dive: what went well, what to watch,
and how you're progressing over time, for example whether your gas consumption is getting better.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)

## Features

- **UDDF import.** Upload `.uddf` files exported from Subsurface, Shearwater Cloud, Garmin Dive,
  Suunto DM5, MacDive, DiveMate and other tools. Several dives per file are supported, and duplicates
  are skipped automatically.
- **Local storage.** The original files and the parsed dives are stored in a local SQLite database
  (`~/.ai-diving-monitor/dives.db`). You can download or delete stored files at any time.
- **Rule-based dive analysis** (works offline, no API key needed):
  - gas consumption: surface RMV (L/min) and SAC (bar/min), plus the remaining gas reserve
  - ascent and descent rates, with fast ascents marked on the profile
  - safety stop and decompression stop compliance, including deco-ceiling violations
  - oxygen exposure: ppO2 (per gas, following gas switches), CNS % and OTU
  - END for trimix, hypoxic-mix detection, sawtooth profiles, NDL margin and computer alarms
  - a 0–100 dive quality score
- **AI coach (Claude).** An agent that uses tools to read your dive, its profile and your whole history,
  then writes a summary: *dive summary → what went well → what to watch → compared with your history →
  focus for your next dive*. You can also chat with it about your log.
- **Progress dashboard.** Interactive charts of RMV, peak ascent rate, safety stop time and dive score
  across your dives, each with a trend line, plus plain-language progress insights such as
  "Gas consumption: improving, 23.5 → 16.2 L/min".
- **Dive details.** Depth profile with deco ceiling and gas switches, tank pressure, ppO2 against the
  1.4 and 1.6 bar limits, and temperature. Every metric is compared with your personal average.

## Quick start

```bash
git clone https://github.com/Torgh/ai-diving-monitor.git
cd ai-diving-monitor
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -e .

# Optional: enables the AI coach
export ANTHROPIC_API_KEY=sk-ant-...       # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."

ai-diving-monitor            # opens the web UI at http://localhost:8501
```

No dive computer at hand? On the **Import dives** page, click **Load sample dives** to load nine
fictional dives that show a diver's progression from spring to autumn, including a trimix deco dive.

### Command line

```bash
ai-diving-monitor import my-dives.uddf   # import without the UI
ai-diving-monitor summary 3              # print the AI review of dive #3
```

### Use it from Claude Code (MCP), no API key needed

AI Diving Monitor ships an [MCP](https://modelcontextprotocol.io) server. When you connect it,
Claude Code (or Claude Desktop, or any other MCP client) becomes your dive coach and uses your own
Claude subscription. The server only exposes your dive log and the analytics.

```bash
# Windows (adjust the path to your clone)
claude mcp add --scope user ai-diving-monitor -- C:\path\to\ai-diving-monitor\.venv\Scripts\python.exe -m ai_diving_monitor.mcp_server
# macOS / Linux
claude mcp add --scope user ai-diving-monitor -- /path/to/ai-diving-monitor/.venv/bin/python -m ai_diving_monitor.mcp_server
```

Optionally install the `/dive-review` slash command for all your Claude Code sessions:

```bash
cp .claude/commands/dive-review.md ~/.claude/commands/
```

Then, in any Claude Code session:

```
/dive-review                      # review of your latest dive, compared with your history
/dive-review 7                    # review of dive id 7
> Import my dives from D:\Shearwater\export.uddf
> Is my gas consumption improving? What should I practise before my next deco dive?
```

| MCP tool | What it does |
|---|---|
| `list_dives` | Dive log with headline metrics |
| `get_dive_analysis` | Full metrics and findings for one dive |
| `get_dive_profile` | Downsampled depth/pressure/temperature profile |
| `get_progress_trend` | Early vs recent comparison for a metric |
| `import_uddf` | Import a `.uddf` file or a folder of them |
| `save_dive_summary` | Store the coach's review so the web app shows it |

The server also provides a `dive-review` MCP prompt (`/mcp__ai-diving-monitor__dive-review`). The web
app and the MCP server share the same database, so dives imported in one show up in the other.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Enables the AI coach |
| `AI_DIVING_MONITOR_DB` | `~/.ai-diving-monitor/dives.db` | Database location |
| `AI_DIVING_MONITOR_MODEL` | `claude-opus-5-5` | Claude model used by the coach |
| `AI_DIVING_MONITOR_EFFORT` | `medium` | Reasoning effort (`low` … `max`) |

## How it works

```
UDDF file ──► uddf.py (parse, SI → m/bar/°C/L) ──► storage.py (SQLite: raw file + dives + analysis)
                                                         │
                         analysis.py (metrics, findings, score, trends)
                                                         │
             ┌───────────────────────────────────────────┴──────────────────┐
         app.py / charts.py (Streamlit + Plotly UI)        tools.py (shared dive-log tools)
                                                              ├─ agent.py      (Claude API tool runner)
                                                              └─ mcp_server.py (Claude Code / MCP clients)
```

The AI coach never receives raw files. It calls tools that return the parsed numbers, so its advice
is based on your actual data. The same tools back both the in-app coach (Claude API) and the MCP
server (Claude Code).

## Development

```bash
pip install -e ".[dev]"
pytest
python scripts/generate_samples.py   # regenerate examples/*.uddf
```

Planned: import of other formats (Subsurface XML, FIT, Shearwater CSV), CCR setpoint analysis and
team/buddy comparisons.

## Disclaimer

AI Diving Monitor is a training and logbook aid. It is **not** a decompression planner, and it does not
replace your training, your dive computer or medical advice. If you have any symptoms of
decompression sickness, contact DAN or the nearest hyperbaric facility immediately.

## License

[MIT](LICENSE) © 2026 Torgh
