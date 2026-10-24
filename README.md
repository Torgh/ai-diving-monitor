# 🤿 AI Diving Monitor

**An AI dive coach for scuba divers.** Import the logs from your dive computer, keep them all in one
local database, and get a clear, data-driven review of every dive: what went well, what to watch,
and how you're progressing over time, for example whether your gas consumption is getting better.
Use the coach with the Claude or ChatGPT subscription you already have, **no API key needed**, or
with an API key from one of five providers.

![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![Python](https://img.shields.io/badge/python-3.10%2B-blue)

> **Moving to TypeScript.** AI Diving Monitor is being rewritten on the stack of its companion trip
> planner [TripDeck](https://github.com/Torgh/tripdeck) (Next.js, Bun, an MCP server in TypeScript and
> later a phone app), so it can prepare you for the dives of a planned trip. The Python version below
> keeps working until the new one replaces it, stage by stage (see [Roadmap](#roadmap)). The last
> Python-only version is tagged [`v0.1-python`](https://github.com/Torgh/ai-diving-monitor/tree/v0.1-python).

## Features

- **UDDF import.** Upload `.uddf` files exported from Subsurface, Shearwater Cloud, Garmin Dive,
  Suunto DM5, MacDive, DiveMate and other tools. Several dives per file are supported, and duplicates
  are skipped automatically. Exporter quirks are handled, such as Shearwater writing CNS in whole
  percent and exporting every tank slot, used or not.
- **Local storage.** The original files and the parsed dives are stored in a local SQLite database
  (`~/.ai-diving-monitor/dives.db`). You can download or delete stored files at any time. Because the
  originals are kept, a newer version of the app parses your dives again with its improved parser,
  keeping their ids and the reviews you saved.
- **Rule-based dive analysis** (works offline, no AI needed):
  - gas consumption: surface RMV (L/min) and SAC (bar/min), plus the remaining gas reserve
  - ascent and descent rates, with fast ascents marked on the profile
  - safety stop and decompression stop compliance, including deco-ceiling violations
  - oxygen exposure: ppO2 (per gas, following gas switches), CNS % and OTU
  - END for trimix, hypoxic-mix detection, sawtooth profiles, NDL margin and computer alarms
  - a 0–100 dive quality score
- **AI coach.** An agent that uses tools to read your dive, its profile and your whole history,
  then writes a review: *dive summary → what went well → what to watch → compared with your history →
  focus for your next dive*. You can also chat with it about your log. It runs either in Claude Code
  or Codex on your own subscription (through the MCP server), or in the app with an API key for
  Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google), DeepSeek or GitHub Copilot (GitHub Models).
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

ai-diving-monitor            # starts the web UI and opens http://localhost:8501
```

No dive computer at hand? On the **Import dives** page, click **Load sample dives** to load nine
fictional dives that show a diver's progression from spring to autumn, including a trimix deco dive.

To update later, run `git pull` and `pip install -e .` again. Your dives are parsed again on the next
start if the parser has improved.

### 1. Coach with your Claude or ChatGPT subscription (MCP, no API key)

AI Diving Monitor ships an [MCP](https://modelcontextprotocol.io) server. Connect it to Claude Code,
Claude Desktop or Codex and the agent becomes your dive coach, on your own Claude Pro/Max or
ChatGPT Plus/Pro plan at no extra cost. The server only exposes your dive log and the analytics.

In the web UI, pick **Claude Pro/Max plan (via Claude Code)** or **ChatGPT Plus/Pro plan (via Codex)**
in **Settings**. The page checks the setup and shows the exact command for your machine. Typically:

```bash
# Claude Code (sign in with /login). Windows: use .venv\Scripts\python.exe
claude mcp add --scope user ai-diving-monitor -- /path/to/ai-diving-monitor/.venv/bin/python -m ai_diving_monitor.mcp_server

# Codex CLI (codex login → Sign in with ChatGPT)
codex mcp add ai-diving-monitor -- /path/to/ai-diving-monitor/.venv/bin/python -m ai_diving_monitor.mcp_server
```

For Claude Desktop, add the same command to `mcpServers` in its config. The web app then shows what
to ask for each dive and displays the saved review. The app itself never signs in to your
subscription or calls the model in these modes (Anthropic does not allow third-party apps to use
claude.ai sign-in); the model runs in Claude Code or Codex.

Then ask in plain language, or use the `dive-review` prompt (`/mcp__ai-diving-monitor__dive-review`):

```
/mcp__ai-diving-monitor__dive-review      # review of your latest dive, compared with your history
/mcp__ai-diving-monitor__dive-review 7    # review of dive id 7
> Import my dives from D:\Shearwater\export.uddf
> Is my gas consumption improving? What should I practise before my next deco dive?
```

For a shorter `/dive-review`, copy the slash command to your Claude Code commands:
`cp .claude/commands/dive-review.md ~/.claude/commands/`.

| MCP tool | What it does |
|---|---|
| `list_dives` | Dive log with headline metrics |
| `get_dive_analysis` | Full metrics and findings for one dive |
| `get_dive_profile` | Downsampled depth/pressure/temperature profile |
| `get_progress_trend` | Early vs recent comparison for a metric |
| `import_uddf` | Import a `.uddf` file or a folder of them |
| `save_dive_summary` | Store the coach's review so the web app shows it |

The web app and the MCP server share the same database, so dives imported in one show up in the
other, and a review the agent saves appears in the app.

### 2. Coach in the app with an API key (optional)

Open **Settings**, pick a provider and a model, and paste your API key (billed per use by the
provider). You can also set the key as an environment variable instead (see [Configuration](#configuration)).

| Provider | API key | Example models |
|---|---|---|
| Claude (Anthropic) | [console.anthropic.com](https://console.anthropic.com/settings/keys) | `claude-opus-5-5`, `claude-sonnet-5-5` |
| ChatGPT (OpenAI) | [platform.openai.com](https://platform.openai.com/api-keys) | `gpt-5`, `gpt-5-mini` |
| Gemini (Google) | [aistudio.google.com](https://aistudio.google.com/apikey) | `gemini-2.5-pro`, `gemini-2.5-flash` |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/api_keys) | `deepseek-chat`, `deepseek-reasoner` |
| GitHub Copilot (GitHub Models) | [GitHub token](https://github.com/settings/personal-access-tokens) with `models:read` | `openai/gpt-4.1` |

Pick **Other model…** to type any model id, or click **Load available models from the API** to list
the models your key can use.

### Command line

```bash
ai-diving-monitor import my-dives.uddf   # import without the UI
ai-diving-monitor summary 3              # print the AI review of dive #3 (API key mode)
ai-diving-monitor mcp                    # run the MCP server manually (normally the agent starts it)
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API key |
| `OPENAI_API_KEY` | – | ChatGPT API key |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | – | Gemini API key |
| `DEEPSEEK_API_KEY` | – | DeepSeek API key |
| `GITHUB_TOKEN` | – | GitHub Models token (`models:read`) |
| `AI_DIVING_MONITOR_PROVIDER` | `anthropic` | Provider when none is chosen in Settings (`anthropic`, `openai`, `gemini`, `deepseek`, `copilot`) |
| `AI_DIVING_MONITOR_MODEL` | first model of the provider | Model when none is chosen in Settings |
| `AI_DIVING_MONITOR_EFFORT` | `medium` | Claude reasoning effort (`low` … `max`) |
| `AI_DIVING_MONITOR_DB` | `~/.ai-diving-monitor/dives.db` | Database location |
| `AI_DIVING_MONITOR_CONFIG` | `~/.ai-diving-monitor/config.json` | Settings file (provider, model, API keys) |

Keys saved in Settings take precedence over environment variables. On the command line, choose the
provider for one run with `ai-diving-monitor summary 3 --provider gemini --model gemini-2.5-flash`.
If you move the database with `AI_DIVING_MONITOR_DB`, set the same variable for the MCP server
(`claude mcp add … -e AI_DIVING_MONITOR_DB=…`), so the app and the agent see the same log.

## Security model

AI Diving Monitor is a **personal, local app**:

- The web UI listens on `127.0.0.1` only, so other devices on your network can't open your dive log.
- The MCP server talks to the agent over stdio on your computer; it opens no network port.
- API keys entered in Settings are stored in plain text in `~/.ai-diving-monitor/config.json`,
  outside the repository. In subscription mode no key is stored at all.
- Usage statistics of the UI framework (Streamlit) are turned off.

Do not expose the app to the internet as-is.

## How it works

```
UDDF file ──► uddf.py (parse, SI → m/bar/°C/L) ──► storage.py (SQLite: raw file + dives + analysis)
                                                         │
                         analysis.py (metrics, findings, score, trends)
                                                         │
             ┌───────────────────────────────────────────┴──────────────────┐
         app.py / charts.py (Streamlit + Plotly UI)        tools.py (shared dive-log tools)
                                                              ├─ agent.py      (Claude / OpenAI-compatible tool loop)
                                                              └─ mcp_server.py (Claude Code / Codex / MCP clients)
```

The AI coach never receives raw files. It calls tools that return the parsed numbers, so its advice
is based on your actual data. The same tools back both the in-app coach (any provider) and the MCP
server. The database records the parser version (`PARSER_VERSION` in `uddf.py`); when it is older,
the stored originals are parsed again on start.

## Development

The repository holds both versions while the TypeScript one is built.

**Python version** (the app you use today):

```bash
pip install -e ".[dev]"
pytest
python scripts/generate_samples.py   # regenerate examples/*.uddf
```

**TypeScript version** (in progress) needs [Bun](https://bun.sh); Node.js 20.9+ also runs the web app:

```bash
bun install          # also points git at the hooks in .githooks/
bun run dev          # development server on http://localhost:3001 (bound to 127.0.0.1)
bun run typecheck    # TypeScript 7 (tsc)
bun run lint         # ESLint, no warnings allowed
bun run test         # Vitest
bun run check        # everything CI runs: typecheck, lint, tests with coverage, build
```

The web app listens on port 3001, so it runs next to the Python UI (8501) and TripDeck (3000). It
only answers requests addressed to `localhost`, which defeats DNS rebinding.

### CI

On every pull request and every commit to `main`, CI runs `bun run check` on Linux, the TypeScript
tests on Windows, and `pytest` on Python 3.10 and 3.12 (Linux) and 3.12 (Windows). It fails when test
coverage of the TypeScript code drops below the thresholds in `vitest.config.mts`. A new push to a
pull request cancels the run for the previous one. CodeQL scans the Python, TypeScript and workflow
code on every pull request, on `main` and weekly. Dependabot opens grouped update pull requests for
Bun, pip and GitHub Actions every Monday, and security fixes as soon as they are published. Actions
are pinned to a commit.

`bun install` points git at the hooks in `.githooks/`: they refuse a commit or push that contains a
secret from `.env.local` or an API key saved in Settings (`~/.ai-diving-monitor/config.json`).

Change parsing? Bump `PARSER_VERSION` in `uddf.py`, so existing databases are parsed again.

### Golden fixtures

`fixtures/golden/` holds what the Python version parses and computes for every test file: the parsed
dive, its metrics, findings and score, and for the sample log the dive list, trends and progress
insights. The TypeScript port is tested against these files, so it must produce the same numbers.
The inputs are `examples/*.uddf` and `fixtures/uddf/*.uddf` (a fictional dive shaped like a
Shearwater export: CNS in whole percent and unused tank slots).

```bash
python scripts/export_golden.py      # rewrite fixtures/golden/ after changing parsing or analysis
```

`pytest` fails when the golden files are out of date.

## Roadmap

AI Diving Monitor is heading towards working like [TripDeck](https://github.com/Torgh/tripdeck): the
agent works on your log directly, the app shows its changes live, and your dives can live on this PC,
in OneDrive or on Google Drive. It gets there by a rewrite in TypeScript, one pull request per stage:

0. **Golden fixtures** from the Python version, so the port can be checked number by number. ✅
1. **Scaffold and CI.** Next.js, Bun, Vitest and ESLint next to the Python code, with CI as in TripDeck. ✅
2. **Core logic in TypeScript.** UDDF parser, dive analysis and trends in `lib/`, tested against the golden fixtures.
3. **Dive files and the MCP server.** One file per dive (this PC, OneDrive or Google Drive), a one-time
   migration from the SQLite database, and an MCP server in TypeScript with new tools to fill in what
   the computer doesn't record (site, buddy, tank volume and gas, notes) and a "to sort out" overview.
4. **Web app.** Dashboard, import, dive log, dive details, coach and settings, refreshing live when the
   agent saves something.
5. **Python retired.** The TypeScript version replaces it.
6. **Prepare for trips.** Link the dive cards of a TripDeck trip to dive sites and your logged dives,
   and let the coach prepare you for each site from your own history.
7. **On the road.** A logbook export (PDF, JSON) and a phone app that works offline.

Also planned: import of other formats (Subsurface XML, FIT, Shearwater CSV), CCR setpoint analysis
and team/buddy comparisons.

## Disclaimer

AI Diving Monitor is a training and logbook aid. It is **not** a decompression planner, and it does not
replace your training, your dive computer or medical advice. If you have any symptoms of
decompression sickness, contact DAN or the nearest hyperbaric facility immediately.

## License

[GNU AGPLv3](LICENSE) © 2026 Torgh
