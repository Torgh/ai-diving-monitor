# 🤿 AI Diving Monitor

**An AI dive coach for scuba divers.** Import the logs from your dive computer and get a clear,
data-driven review of every dive: what went well, what to watch, and how you're progressing over
time, for example whether your gas consumption is getting better. Use the coach with the Claude or
ChatGPT subscription you already have, **no API key needed**, or with a Claude or ChatGPT API key.
Your dives stay yours: on this PC, in OneDrive or on Google Drive.

![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-Next.js%20%2B%20Bun-blue)

AI Diving Monitor works like its companion trip planner [TripDeck](https://github.com/Torgh/tripdeck):
the coach in Claude Code or Codex works on your log directly through an MCP server, and the web app
shows its changes within seconds. It was rewritten from Python to TypeScript; the Python version
(a Streamlit app on SQLite) is kept under the tag
[`v0.1-python`](https://github.com/Torgh/ai-diving-monitor/tree/v0.1-python), and its log can be
copied over.

## Features

- **UDDF import.** Upload `.uddf` files exported from Subsurface, Shearwater Cloud, Garmin Dive,
  Suunto DM5, MacDive, DiveMate and other tools. Several dives per file are supported, and duplicates
  are skipped automatically. Exporter quirks are handled, such as Shearwater writing CNS in whole
  percent and exporting every tank slot, used or not, and files in any encoding they declare.
- **Your dives as files, where you want them.** Each dive is one `*.dive.json` file next to the
  original UDDF file it came from, on this PC, in your OneDrive folder or on Google Drive. Because the
  originals are kept, a newer version of the app parses your dives again with its improved parser,
  keeping what you filled in and the reviews.
- **Fill in what the computer doesn't record.** Dive site, location, buddy, notes, the tank volume and
  the gas, on the dive's page or by telling your coach. A tank volume gives the dive its gas
  consumption at once; the gas gives ppO2, CNS and END. A "to sort out" list says what is still
  missing.
- **Rule-based dive analysis** (works offline, no AI needed):
  - gas consumption: surface RMV (L/min) and SAC (bar/min), plus the remaining gas reserve
  - ascent and descent rates, with fast ascents marked on the profile
  - safety stop and decompression stop compliance, including deco-ceiling violations
  - oxygen exposure: ppO2 (per gas, following gas switches), CNS % and OTU
  - END for trimix, hypoxic-mix detection, sawtooth profiles, NDL margin and computer alarms
  - a 0–100 dive quality score
- **AI coach.** An agent that uses tools to read your dive, its profile and your whole history, then
  writes a review: *dive summary → what went well → what to watch → compared with your history → focus
  for your next dive*. It runs in Claude Code or Codex on your own subscription (through the MCP
  server), or in the app with a Claude or ChatGPT API key.
- **Ready for your next trip.** With [TripDeck](https://github.com/Torgh/tripdeck) connected to the
  same agent, the coach reads a trip's dive cards and prepares you for each one from your own log:
  comparable dives (the same site first, then the closest depth), time since your last dive, your gas
  consumption at the planned depth, ppO2, MOD and the richest nitrox for it, and the problems that
  keep coming back. The *Trips* page shows each dive card with the preparation and the numbers behind
  it, and the dashboard the trip coming next. After the trip, link each logged dive to its card there
  (or let the coach do it).
- **Live dashboard.** Dives logged, time underwater, the deepest dive, the latest score, progress
  insights such as "Gas consumption: improving, 23.5 → 16.2 L/min", and charts of RMV, peak ascent
  rate, safety stop time and score across your dives, each with its trend line. Every page updates
  within seconds when your coach changes the log.
- **Dive details.** The metrics beside your average, the findings, the coach's review, and the
  profile: depth with the computer's deco stops, gas switches and fast ascents, and tank pressure,
  ppO2 (1.4 and 1.6 bar lines) and water temperature below it on the same time axis. Every chart has a
  crosshair, works with the arrow keys and has a table view. Light and dark mode follow your system.

## Quick start

Requirements: [Bun](https://bun.sh) (it runs the MCP server and the app; Node.js 20.9+ also runs the
web app).

```bash
git clone https://github.com/Torgh/ai-diving-monitor.git
cd ai-diving-monitor
bun install
bun run dev          # http://localhost:3001 (bound to 127.0.0.1)
```

On the **Import dives** page, drop your UDDF files. No dive computer at hand? Click **Load sample
dives** for nine fictional dives that show a diver's progression from spring to autumn, including a
trimix deco dive. Used the Python version before? **Copy my old log** there (or `bun run migrate`)
copies every dive and saved review from its database, which is only read.

To update later, run `git pull` and `bun install`. Your dives are parsed again when the parser has
improved.

### 1. Coach with your Claude or ChatGPT subscription (MCP, no API key)

AI Diving Monitor ships an [MCP](https://modelcontextprotocol.io) server. Connect it to Claude Code,
Claude Desktop or Codex and the agent becomes your dive coach, on your own Claude Pro/Max or ChatGPT
Plus/Pro plan at no extra cost. The server only exposes your dive log and the analytics.

In **Settings**, pick **Claude Pro/Max plan (via Claude Code)** or **ChatGPT Plus/Pro plan (via
Codex)**. The page checks whether the server is connected and shows the exact command for your
computer, including the environment that points it at the same data folder. Typically:

```bash
# Claude Code (sign in with /login)
claude mcp add --scope user ai-diving-monitor -- ~/.bun/bin/bun /path/to/ai-diving-monitor/mcp/server.ts

# Codex CLI (codex login → Sign in with ChatGPT)
codex mcp add ai-diving-monitor -- ~/.bun/bin/bun /path/to/ai-diving-monitor/mcp/server.ts
```

For Claude Desktop, add the same command to `mcpServers` in its config. If Claude Code or Codex still
runs the Python version's server, Settings shows the commands that switch it over. The app itself
never signs in to your subscription or calls the model in these modes (Anthropic does not allow
third-party apps to use claude.ai sign-in); the model runs in Claude Code or Codex.

Then ask in plain language, or use the prompts:

```
/mcp__ai-diving-monitor__dive-review      # review of your latest dive, compared with your history
/mcp__ai-diving-monitor__dive-review 7    # review of dive 7 (1 = your oldest dive)
/mcp__ai-diving-monitor__sort-out         # go through what your log is still missing, one dive at a time
/mcp__ai-diving-monitor__trip-prep Dahab  # get ready for the dives of a TripDeck trip
> Import my dives from D:\Shearwater\export.uddf
> Dive 2 was at Koparki with a 12 L tank of EAN32.
> Is my gas consumption improving? What should I practise before my next deco dive?
```

Settings can also install a shorter `/dive-review` command for all Claude Code sessions.

| MCP tool | What it does |
|---|---|
| `list_dives` | Dive log with headline metrics, each dive's number and id |
| `get_overview` | The log at a glance: dives, the latest one, trends, and what is still missing ("to sort out": tank volume, gas, site, review) |
| `get_dive_analysis` | Full metrics and findings for one dive, with what the diver filled in |
| `get_dive_profile` | Downsampled depth/pressure/temperature profile |
| `get_progress_trend` | Early vs recent comparison for a metric |
| `import_uddf` | Import a `.uddf` file or a folder of them |
| `update_dive` | Fill in the site, location, buddy, notes, the main tank's volume and gas (`air`, `EAN32`, `Tx 18/45`…) |
| `save_dive_summary` | Store the coach's review so the app shows it |
| `prepare_dive` | Get ready for a planned dive (site, depth, gas, date) from your log: experience, gas plan, ppO2/MOD, recurring problems |
| `save_trip_plan` | Store a TripDeck trip's dive cards with the coach's preparation for each, and the logged dives they turned into |
| `get_trip_plans` | The saved trips; one trip's cards with the dives logged on each card's day |
| `migrate_from_python` | Copy the Python version's log, as `bun run migrate` does |

Dives are referred to by their number in the log (`1` = the oldest) or by their id. The coach is told
to save what you tell it with `update_dive` and never to invent a tank size or a gas.

**Trips.** Connect TripDeck's MCP server to the same Claude Code or Codex, then run `trip-prep`. The
coach reads the trip with TripDeck's `get_trip` and stores its dive cards and the preparation here,
one `*.trip.json` file per trip next to your dives; TripDeck stays where the trip is planned, so
running it again after a change in TripDeck updates the cards and keeps the preparation of the ones
that stayed. The app never reads TripDeck's files itself, so it works wherever TripDeck keeps them.
*Forget this trip* on its page removes it here only; the trip stays in TripDeck.

### 2. Coach in the app with an API key (optional)

In **Settings**, pick **Claude API key** or **ChatGPT API key**, paste the key (billed per use by the
provider) and choose the model, or *Load models from the API* to list the ones your key can use. The
**AI coach** page then chats with the coach, and each dive's page can ask for a review, which is
saved with the dive.

| Provider | API key | Example models |
|---|---|---|
| Claude (Anthropic) | [console.anthropic.com](https://console.anthropic.com/settings/keys) | `claude-opus-5-5`, `claude-sonnet-5-5` |
| ChatGPT (OpenAI) | [platform.openai.com](https://platform.openai.com/api-keys) | `gpt-5`, `gpt-5-mini` |

The in-app coach uses the MCP server's read-only tools. On Claude it runs through the Anthropic SDK's
tool runner: `claude-opus-5-5` by default, effort `high`, and on the models that support it a
server-side fallback when a request is declined. On ChatGPT it runs through OpenAI's Chat
Completions. A declined, cut-off or empty answer is shown, never saved as a dive's review.

### 3. Where your dives are stored

*Settings → Where your dives are stored* chooses **This PC**, **OneDrive** or **Google Drive**.
Switching copies your dives and trips to the new place (the copy with the newer changes wins); the
old place keeps its copy. The MCP server follows the choice at once.

- **This PC**: `dives/`, `originals/` and `trips/` in the data folder (`AI_DIVING_MONITOR_HOME`, else the
  folder of `AI_DIVING_MONITOR_DB`, else `~/.ai-diving-monitor`).
- **OneDrive**: an *AI Diving Monitor* folder inside your OneDrive folder on this PC (on Windows
  `%OneDrive%`, on macOS under `~/Library/CloudStorage/OneDrive-…`), synced by the OneDrive app. No
  sign-in needed. If it isn't found, enter the folder in Settings or set
  `AI_DIVING_MONITOR_ONEDRIVE_FOLDER`. When two computers change the same dive offline, OneDrive keeps
  both files and the newer one wins; the next save removes the other.
- **Google Drive**: *My Drive › AI Diving Monitor*. The app asks only for `drive.file`: the files it
  created, never your other files. It needs your own OAuth client, once, and Settings walks you
  through it:
  1. In Google Cloud, enable the **Google Drive API**.
  2. Under *Google Auth Platform*, set the audience to *External* and **publish the app** (apps left in
     testing mode get logged out every 7 days).
  3. Create an OAuth client of type *Web application* with the redirect URI
     `http://localhost:3001/api/auth/google/callback`.
  4. Paste the client ID and secret into Settings and click **Connect Google Drive**.

Settings, API keys, the Google sign-in and the locks always stay in the data folder on this computer.

### Configuration

Everything is set in **Settings**; environment variables still work, and a saved setting wins.

| Variable | Default | Purpose |
|---|---|---|
| `AI_DIVING_MONITOR_HOME` | the folder of `AI_DIVING_MONITOR_DB`, else `~/.ai-diving-monitor` | Data folder: settings, sign-in, locks, and the dives when they're stored on this PC |
| `AI_DIVING_MONITOR_DB` | `~/.ai-diving-monitor/dives.db` | The Python version's database (for the migration) |
| `AI_DIVING_MONITOR_CONFIG` | `config.json` in the data folder | Settings file (the same one the Python version used) |
| `AI_DIVING_MONITOR_ONEDRIVE_FOLDER` | found automatically | Your OneDrive folder |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | – | API keys for the in-app coach |
| `AI_DIVING_MONITOR_PROVIDER`, `AI_DIVING_MONITOR_MODEL` | Claude, `claude-opus-5-5` | How the coach runs, when nothing is chosen in Settings |
| `AI_DIVING_MONITOR_EFFORT` | `high` | Claude's effort for the in-app coach (`low` … `max`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | – | The Google OAuth client |

When you set any of the `AI_DIVING_MONITOR_*` folders, give the MCP server the same values
(`claude mcp add … -e NAME=value`); the command Settings shows includes them.

## Security model

AI Diving Monitor is a **personal, local app**:

- The web app listens on `127.0.0.1` only, so other devices on your network can't open your dive log.
- Its API only answers requests addressed to `localhost` (which defeats DNS rebinding) and coming
  from its own pages; changes need a JSON body or, for uploads, a same-site Origin, which blocks
  cross-site form posts.
- The MCP server talks to the agent over stdio on your computer; it opens no network port.
- API keys and the Google OAuth client secret are stored in plain text in `config.json` in the data
  folder, outside the repository; the Google refresh token in `google-token.json` next to it. They
  are never synced to OneDrive or Google Drive, and Settings only ever shows a key's last four
  characters. In subscription mode no key is stored at all.
- Google Drive access is limited to the files the app created (`drive.file`).

Do not expose the app to the internet as-is.

## How it works

```
lib/
  uddf.ts        UDDF parser (any encoding the file declares; UDDF 2.x dates; exporter quirks)
  xml.ts         a small element tree over fast-xml-parser, read the way Python's ElementTree reads it
  dive.ts        dive, tank, sample and gas types; gas labels; the fingerprint that spots duplicates
  analysis.ts    metrics, findings, score, trends and progress insights
  record.ts      a stored dive: what the computer recorded, what the diver filled in, the review; "to sort out"
  prep.ts        getting ready for a planned dive from the log: experience, gas plan, ppO2/MOD, recurring problems
  trip.ts        a TripDeck trip's dive cards with the preparation and the logged dives; following TripDeck's changes
  coach.ts       the coach's instructions and tool answers (snake_case JSON, as the Python version answered)
  coachTools.ts  the in-app coach's tools (the MCP server's read-only tools), with argument checks
  views.ts       what the pages show: the log, its totals, trends and to-do list; one dive and its profile
  tripViews.ts   the Trips pages: which trip is next, and each dive card with its preparation and logged dives
  providers.ts   how the coach runs: Claude Code, Codex, or a Claude or ChatGPT API key
  units.ts, py.ts, sha256.ts   SI units; Python's rounding and float printing; synchronous SHA-256
  server/
    diveStore.ts one *.dive.json file per dive and the original UDDF files, on any backend; parsing
                 again after parser upgrades; a cache of parsed dives; copying the log between places
    tripStore.ts one *.trip.json file per trip, next to the dives
    backends.ts  where the log lives: a folder (this PC, OneDrive) or Google Drive
    googleDrive.ts, cloudAuth.ts   Google Drive files, and the Google sign-in (OAuth with PKCE)
    storage.ts   switching the place, copying the dives and trips over
    files.ts     atomic writes, and a lock per dive shared by the MCP server and the web app
    config.ts    settings and API keys, in the same config.json as the Python version
    coachAgent.ts the in-app coach: Claude (tool runner) or ChatGPT (Chat Completions)
    agentApps.ts is the MCP server connected to Claude Code / Codex, and the commands to (re)connect it
    migrate.ts   one-time copy of the Python version's SQLite log
    http.ts, version.ts, paths.ts   API guards; the tag the browser polls; the data folder
mcp/server.ts    MCP server (stdio, run by Bun)
app/             web app (Next.js): dashboard, dive log, dive details, trips, import, coach, settings; api/
components/      LineChart (SVG, shared crosshair, keyboard, table view), profile charts, forms
```

The AI coach never receives raw files. It calls tools that return the parsed numbers, so its advice
is based on your actual data. A dive file keeps what the dive computer recorded, parsed from the
original UDDF file, plus what the diver or the coach filled in later and the review; the analysis is
computed when the dive is read, from the dive with those details applied. The browser polls a tag of
the dives folder every 3 seconds and reloads only when it changes, so a review saved in Claude Code
appears without a refresh.

## Development

```bash
bun install          # also points git at the hooks in .githooks/
bun run dev          # development server on http://localhost:3001
bun run typecheck    # TypeScript 7 (tsc)
bun run lint         # ESLint, no warnings allowed
bun run test         # Vitest
bun run check        # everything CI runs: typecheck, lint, tests with coverage, build
bun run mcp          # run the MCP server manually (normally Claude Code or Codex starts it)
bun run migrate      # copy the Python version's log into dive files (safe to run again)
bun run golden       # rewrite fixtures/golden/ (see below)
```

Tests never touch your real dives or home folder: each suite uses its own temporary data folder and
home, and Google Drive is replaced with an in-memory fake. Change parsing? Bump `PARSER_VERSION` in
`lib/uddf.ts`, so stored dives are parsed again.

### CI

On every pull request and every commit to `main`, CI runs `bun run check` on Linux and the tests on
Windows. It fails when test coverage drops below the thresholds in `vitest.config.mts`. A new push to
a pull request cancels the run for the previous one. CodeQL scans the TypeScript and workflow code on
every pull request, on `main` and weekly. Dependabot opens grouped update pull requests for Bun and
GitHub Actions every Monday, and security fixes as soon as they are published. Actions are pinned to
a commit, and `main` only takes pull requests whose checks pass.

`bun install` points git at the hooks in `.githooks/`: they refuse a commit or push that contains a
secret from `.env.local`, an API key or the Google client secret saved in Settings, or the Google
sign-in tokens.

### Golden fixtures

`fixtures/golden/` holds what the Python version parsed and computed for every test file: the parsed
dive, its metrics, findings and score, and for the sample log the dive list, trends and progress
insights. The TypeScript version was ported against these files and is still tested against them,
so a change that moves any number shows up. The inputs are `examples/*.uddf` and
`fixtures/uddf/*.uddf`:

- `shearwater-style.uddf`: a fictional dive shaped like a Shearwater export, with CNS in whole percent
  and unused tank slots
- `edge-cases.uddf`: fictional dives that reach the branches the sample log doesn't. Among them are
  deco with a violated ceiling and with stops kept, gas switches, trimix END, computer ppO2 and alarms,
  a rocket ascent after a sawtooth, a hypoxic gas, CNS as fractions, a dive without a date and a single
  sample. The file also covers UDDF 2.x dates, time zones, mixed-content notes and ISO-8859-1.

`lib/golden.test.ts` fails when the app parses or analyses any of these files differently: every
number, finding, text, fingerprint, trend and progress insight must match. When a change is meant to
alter them (a fixed parser bug, a new metric), `bun run golden` rewrites the files from the current
code; check the diff, since from then on it is the new reference. The scripts that generated the
inputs and the first golden files are in the Python version.

## Roadmap

AI Diving Monitor is heading towards working like [TripDeck](https://github.com/Torgh/tripdeck), by a
rewrite in TypeScript, one pull request per stage:

0. **Golden fixtures** from the Python version, so the port can be checked number by number. ✅
1. **Scaffold and CI.** Next.js, Bun, Vitest and ESLint next to the Python code, with CI as in TripDeck. ✅
2. **Core logic in TypeScript.** UDDF parser, dive analysis and trends in `lib/`, tested against the golden fixtures. ✅
3. **Dive files and the MCP server.** One file per dive, a one-time migration from the SQLite
   database, and an MCP server in TypeScript with tools to fill in what the computer doesn't record and
   a "to sort out" overview. ✅
4. **Web app**, in three pull requests:
   - 4a. Dashboard, dive log, dive details with profile charts, details form and import, refreshing
     live when the agent saves something. ✅
   - 4b. Settings and the coach: a Claude or ChatGPT API key in the app, and the subscription through
     Claude Code or Codex. The TypeScript MCP server replaces the Python one. ✅
   - 4c. Where the dives are stored: this PC, OneDrive or Google Drive. ✅
5. **Python retired.** The Streamlit app, the SQLite storage and the Python tests left the repository;
   the golden fixtures and the copy of an old log stayed. ✅
6. **Prepare for trips**, in three pull requests:
   - 6a. The coach prepares you for each dive card of a TripDeck trip from your own history, stores
     the trip with its preparation, and links your logged dives to the cards after the trip. ✅
   - 6b. A *Trips* page in the app with the preparation of each dive, and the next trip on the dashboard. ✅
   - 6c. TripDeck shows on its dive cards whether you are prepared, with a link to the app.
7. **On the road.** A logbook export (PDF, JSON) and a phone app that works offline.

Also planned: import of other formats (Subsurface XML, FIT, Shearwater CSV), CCR setpoint analysis
and team/buddy comparisons.

## Disclaimer

AI Diving Monitor is a training and logbook aid. It is **not** a decompression planner, and it does not
replace your training, your dive computer or medical advice. If you have any symptoms of
decompression sickness, contact DAN or the nearest hyperbaric facility immediately.

## License

[GNU AGPLv3](LICENSE) © 2026 Torgh
