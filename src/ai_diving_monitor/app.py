"""Streamlit user interface for AI Diving Monitor.

Run with:  ai-diving-monitor   (or)   streamlit run src/ai_diving_monitor/app.py
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from statistics import mean

import pandas as pd
import streamlit as st

from ai_diving_monitor import charts, providers
from ai_diving_monitor.analysis import progress_insights
from ai_diving_monitor.storage import DiveStore
from ai_diving_monitor.uddf import UDDFParseError

st.set_page_config(page_title="AI Diving Monitor", page_icon="🤿", layout="wide")

PAGES = ["Dashboard", "Import dives", "Dive log", "Dive details", "AI coach", "Stored files", "Settings"]
SEVERITY_ICON = {"critical": "⛔", "warning": "⚠️", "info": "ℹ️", "good": "✅"}
EXAMPLES_DIR = Path(__file__).resolve().parents[2] / "examples"
REVIEW_COMMAND_SRC = Path(__file__).resolve().parents[2] / ".claude" / "commands" / "dive-review.md"


@st.cache_resource
def get_store() -> DiveStore:
    return DiveStore()


store = get_store()


def ai_configured() -> bool:
    return providers.is_configured(providers.selected()[0].id)


# Subscription mode: the coach runs in the diver's own agent app (signed in with their plan) through the MCP server.
AGENT_APPS = {
    "claude-code": {
        "app": "Claude Code", "plan": "Claude plan", "account": "Claude account",
        "login": "run `claude`, then `/login`",
        "mcp_add": 'claude mcp add --scope user ai-diving-monitor -- "{python}" -m ai_diving_monitor.mcp_server',
    },
    "codex": {
        "app": "Codex", "plan": "ChatGPT plan", "account": "ChatGPT account",
        "login": "run `codex login` and choose **Sign in with ChatGPT**",
        "mcp_add": 'codex mcp add ai-diving-monitor -- "{python}" -m ai_diving_monitor.mcp_server',
    },
}


def agent_app() -> dict | None:
    """The agent app the diver uses with their subscription instead of an API key, if any."""
    provider = providers.selected()[0]
    return None if provider.uses_api else {"id": provider.id, **AGENT_APPS[provider.id]}


def review_request(app_id: str, dive_id: int) -> str:
    if app_id == "codex":
        return f"Review dive #{dive_id} from my AI Diving Monitor log and save the review with save_dive_summary."
    if providers.agent_app_status(app_id).review_command_installed:
        return f"/dive-review {dive_id}"
    return f"/mcp__ai-diving-monitor__dive-review {dive_id}"


def go_to(page: str, dive_id: int | None = None) -> None:
    st.session_state["nav_pending"] = page
    if dive_id is not None:
        st.session_state["selected_dive"] = dive_id
    st.rerun()


def fmt_date(iso: str | None) -> str:
    return iso.replace("T", " ")[:16] if iso else "Unknown date"


def dive_label(d: dict) -> str:
    return f"#{d['seq']} · {fmt_date(d['start'])} · {d.get('site') or 'Unknown site'} · {d['max_depth_m']} m / {d['duration_min']:.0f} min"


def render_findings(findings: list[dict]) -> None:
    box = {"critical": st.error, "warning": st.warning, "info": st.info, "good": st.success}
    for f in findings:
        box[f["severity"]](f"**{f['title']}** — {f['detail']}", icon=SEVERITY_ICON[f["severity"]])


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------
if "nav_pending" in st.session_state:
    st.session_state["nav"] = st.session_state.pop("nav_pending")

with st.sidebar:
    st.title("🤿 AI Diving Monitor")
    st.caption("Your dive computer data, turned into coaching.")
    page = st.radio("Navigate", PAGES, key="nav", label_visibility="collapsed")
    st.divider()
    active_provider, active_model = providers.selected()
    if app := agent_app():
        st.success(f"AI coach: your {app['plan']}  \nvia {app['app']}", icon="🧠")
    elif ai_configured():
        st.success(f"AI coach ready  \n{active_provider.name} · `{active_model}`", icon="🧠")
    else:
        st.info(f"AI coach offline — add a {active_provider.name} API key in **Settings** to enable AI "
                "summaries. Rule-based analysis works without it.", icon="🔑")
    st.caption(f"Database: `{store.path}`")

dives = store.list_dives()


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------
def page_dashboard() -> None:
    st.header("Dashboard")
    if not dives:
        st.info("No dives yet. Import a UDDF file exported from your dive computer or dive log software to get started.")
        if st.button("Import dives", type="primary"):
            go_to("Import dives")
        return

    total_min = sum(d["duration_min"] for d in dives)
    rmvs = [d["rmv_l_min"] for d in dives if d.get("rmv_l_min")]
    recent_rmv = mean(rmvs[-5:]) if rmvs else None
    c = st.columns(5)
    c[0].metric("Dives logged", len(dives))
    c[1].metric("Total dive time", f"{total_min / 60:.1f} h")
    c[2].metric("Deepest dive", f"{max(d['max_depth_m'] for d in dives)} m")
    c[3].metric("Avg RMV (last 5)", f"{recent_rmv:.1f} L/min" if recent_rmv else "—",
                delta=f"{recent_rmv - mean(rmvs):+.1f} vs all-time" if rmvs and len(rmvs) > 5 else None,
                delta_color="inverse")
    c[4].metric("Avg score (last 5)", f"{mean(d['score'] for d in dives[-5:]):.0f}/100")

    st.subheader("Your progress")
    insights = progress_insights(dives)
    render_findings([{"severity": i.severity, "title": i.title, "detail": i.detail} for i in insights])

    left, right = st.columns(2)
    with left:
        if rmvs:
            st.plotly_chart(charts.progress_line(dives, "rmv_l_min", "Gas consumption (RMV)", "L/min"),
                            width="stretch")
        else:
            st.info("Gas consumption needs tank volume and start/end pressure in your UDDF export.")
        st.plotly_chart(charts.score_bars(dives), width="stretch")
    with right:
        st.plotly_chart(charts.progress_line(dives, "max_ascent_rate_m_min", "Peak ascent rate", "m/min",
                                             limit=10, limit_label="10 m/min recommended max"),
                        width="stretch")
        st.plotly_chart(charts.progress_line(dives, "safety_stop_s", "Safety stop time", "s",
                                             limit=180, limit_label="3 min target", lower_is_better=False),
                        width="stretch")

    st.subheader("Latest dive")
    last = dives[-1]
    st.markdown(f"**{dive_label(last)}** — score **{last['score']}/100**")
    if st.button("Open latest dive"):
        go_to("Dive details", last["id"])


def page_import() -> None:
    st.header("Import dives")
    st.markdown(
        "Export your dives as **UDDF** (Universal Dive Data Format) from your dive computer software "
        "(e.g. Subsurface, Shearwater Cloud, Garmin Dive, Suunto DM5, MacDive, DiveMate) and upload the file here. "
        "The original file is stored in the local database and duplicate dives are skipped automatically."
    )
    files = st.file_uploader("UDDF files", type=["uddf", "xml"], accept_multiple_files=True)
    if files and st.button(f"Import {len(files)} file(s)", type="primary"):
        for f in files:
            try:
                r = store.import_file(f.name, f.getvalue())
                msg = f"**{f.name}**: {r.added} new dive(s)"
                if r.duplicates:
                    msg += f", {r.duplicates} already in your log"
                (st.success if r.added else st.info)(msg)
            except UDDFParseError as exc:
                st.error(f"**{f.name}**: {exc}")
        st.button("Refresh view")

    samples = sorted(EXAMPLES_DIR.glob("*.uddf")) if EXAMPLES_DIR.exists() else []
    if samples:
        st.divider()
        st.markdown("**No dive computer at hand?** Load the bundled sample dives to explore the app.")
        if st.button("Load sample dives"):
            added = sum(store.import_file(p.name, p.read_bytes()).added for p in samples)
            st.success(f"Loaded {added} sample dive(s).")
            go_to("Dashboard")


def page_log() -> None:
    st.header("Dive log")
    if not dives:
        st.info("Your log is empty.")
        return
    df = pd.DataFrame([{
        "Dive": d["seq"],
        "Date": fmt_date(d["start"]),
        "Site": d.get("site") or "",
        "Max depth (m)": d["max_depth_m"],
        "Duration (min)": d["duration_min"],
        "Gas": ", ".join(d["gases"]),
        "RMV (L/min)": d.get("rmv_l_min"),
        "Peak ascent (m/min)": d["max_ascent_rate_m_min"],
        "Deco": "yes" if d["had_deco"] else "",
        "Score": d["score"],
        "Status": SEVERITY_ICON[d["worst_severity"]],
    } for d in reversed(dives)])
    st.caption("Select a row to open the dive.")
    event = st.dataframe(
        df, hide_index=True, width="stretch", on_select="rerun", selection_mode="single-row",
        column_config={"Score": st.column_config.ProgressColumn("Score", min_value=0, max_value=100, format="%d")},
    )
    if event and event.selection.rows:
        seq = df.iloc[event.selection.rows[0]]["Dive"]
        go_to("Dive details", next(d["id"] for d in dives if d["seq"] == seq))


def page_details() -> None:
    st.header("Dive details")
    if not dives:
        st.info("Import some dives first.")
        return
    ids = [d["id"] for d in dives][::-1]
    default = st.session_state.get("selected_dive", ids[0])
    dive_id = st.selectbox("Dive", ids, index=ids.index(default) if default in ids else 0,
                           format_func=lambda i: dive_label(next(d for d in dives if d["id"] == i)))
    st.session_state["selected_dive"] = dive_id
    dive = store.get_dive(dive_id)
    analysis = store.get_analysis(dive_id)
    m = analysis["metrics"]
    others = [d for d in dives if d["id"] != dive_id]

    def delta(key: str, unit: str):
        vals = [d[key] for d in others if d.get(key) is not None]
        if m.get(key) is None or not vals:
            return None
        return f"{m[key] - mean(vals):+.1f} {unit} vs your avg"

    c = st.columns(6)
    c[0].metric("Max depth", f"{m['max_depth_m']} m", delta("max_depth_m", "m"), delta_color="off")
    c[1].metric("Duration", f"{m['duration_min']:.0f} min", delta("duration_min", "min"), delta_color="off")
    c[2].metric("RMV", f"{m['rmv_l_min']} L/min" if m["rmv_l_min"] else "—", delta("rmv_l_min", "L/min"),
                delta_color="inverse")
    c[3].metric("Peak ascent", f"{m['max_ascent_rate_m_min']} m/min", delta("max_ascent_rate_m_min", "m/min"),
                delta_color="inverse")
    c[4].metric("Max ppO2 / CNS", f"{m['max_ppo2'] or '—'} / {m['cns_percent']:.0f}%")
    c[5].metric("Score", f"{m['score']}/100", delta("score", "pts"))

    meta = [f"🗓 {fmt_date(dive.start.isoformat() if dive.start else None)}",
            f"📍 {dive.site or 'Unknown site'}{', ' + dive.location if dive.location else ''}",
            f"🫧 {', '.join(m['gases']) or 'Unknown gas'}"]
    if m["min_temp_c"] is not None:
        meta.append(f"🌡 {m['min_temp_c']} °C min")
    if m["gas_used_l"]:
        meta.append(f"⛽ {m['gas_used_l']} L used, ended at {m['end_pressure_bar']} bar")
    if dive.computer:
        meta.append(f"⌚ {dive.computer}")
    st.caption("  ·  ".join(meta))

    tab_summary, tab_profile, tab_findings = st.tabs(["🧠 AI summary", "📈 Profile", "🔍 Findings"])
    with tab_profile:
        st.plotly_chart(charts.dive_profile(dive), width="stretch")
        if dive.notes:
            st.markdown(f"**Your notes:** {dive.notes}")
    with tab_findings:
        render_findings(analysis["findings"])
        with st.expander("All metrics"):
            st.json(m)
    with tab_summary:
        summary = store.get_summary(dive_id)
        if app := agent_app():
            if summary:
                st.markdown(summary)
            st.info(f"Get this review in **{app['app']}**: it uses your {app['plan']}, no API key needed. "
                    f"Paste the line below into {app['app']}, then click **Refresh**.", icon="💬")
            st.code(review_request(app["id"], dive_id), language=None)
            if st.button("Refresh"):
                st.rerun()
            if not summary:
                st.caption("Meanwhile, here is the rule-based review:")
                render_findings(analysis["findings"])
            return
        label = "Regenerate AI summary" if summary else "Generate AI summary"
        if st.button(label, type="primary", disabled=not ai_configured()):
            from ai_diving_monitor.agent import describe_api_error, summarize_dive
            with st.spinner("Your AI coach is reviewing the dive and your history…"):
                try:
                    summary = summarize_dive(store, dive_id)
                except Exception as exc:  # surfaced to the user, not swallowed
                    st.error(describe_api_error(exc))
        if summary:
            st.markdown(summary)
        elif not ai_configured():
            st.info("Add an API key in **Settings** to get a coaching summary. "
                    "Meanwhile, here is the rule-based review:")
            render_findings(analysis["findings"])


def page_coach() -> None:
    st.header("AI coach")
    st.caption("Ask anything about your dives — e.g. *“Is my air consumption improving?”*, "
               "*“What should I practise before my next deco dive?”*")
    if app := agent_app():
        st.info(f"You use the coach through **{app['app']}** with your {app['plan']}. Ask your questions "
                "there; it reads the same dive log as this app.", icon="💬")
        st.code("Is my gas consumption improving?\nWhat should I practise before my next deco dive?",
                language=None)
        return
    if not ai_configured():
        st.warning("Add an API key for your AI provider in **Settings** to chat with the coach.")
        return
    history = st.session_state.setdefault("chat", [])
    for msg in history:
        with st.chat_message(msg["role"], avatar="🤿" if msg["role"] == "user" else "🧠"):
            st.markdown(msg["content"])
    if question := st.chat_input("Ask your dive coach…"):
        with st.chat_message("user", avatar="🤿"):
            st.markdown(question)
        with st.chat_message("assistant", avatar="🧠"):
            from ai_diving_monitor.agent import ask_coach, describe_api_error
            with st.spinner("Looking through your log…"):
                try:
                    answer = ask_coach(store, question, history, st.session_state.get("selected_dive"))
                except Exception as exc:
                    st.error(describe_api_error(exc))
                    return
            st.markdown(answer)
        history += [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]
    if history and st.button("Clear conversation"):
        st.session_state["chat"] = []
        st.rerun()


def page_files() -> None:
    st.header("Stored files")
    files = store.list_files()
    if not files:
        st.info("No files stored yet.")
        return
    for f in files:
        cols = st.columns([4, 2, 1, 1, 1])
        cols[0].markdown(f"**{f['filename']}**  \n<small>{f['format'].upper()} · imported {fmt_date(f['imported_at'])}</small>",
                         unsafe_allow_html=True)
        cols[1].markdown(f"{f['dives']} dive(s) · {f['size'] / 1024:.0f} KB")
        cols[2].download_button("Download", store.get_file_content(f["id"]), file_name=f["filename"],
                                key=f"dl{f['id']}")
        if cols[3].button("Delete", key=f"del{f['id']}"):
            st.session_state["confirm_delete"] = f["id"]
        if st.session_state.get("confirm_delete") == f["id"]:
            if cols[4].button("Confirm", key=f"conf{f['id']}", type="primary"):
                store.delete_file(f["id"])
                st.session_state.pop("confirm_delete")
                st.rerun()


CUSTOM_MODEL = "Other model…"


def page_settings() -> None:
    st.header("Settings")
    st.subheader("AI coach")
    current, current_model = providers.selected()
    ids = list(providers.PROVIDERS)
    pid = st.selectbox("AI provider", ids, index=ids.index(current.id),
                       format_func=lambda i: providers.PROVIDERS[i].name)
    provider = providers.PROVIDERS[pid]
    if provider.note:
        st.caption(provider.note)
    if not provider.uses_api:
        settings_agent_app(provider, current.id == pid)
        return

    # API key
    source = providers.key_source(pid)
    saved = providers.saved_key(pid)
    if saved:
        st.success(f"API key saved ({providers.mask(saved)}).", icon="🔑")
    elif source:
        st.info(f"Using credentials from `{source}`.", icon="🔑")
    else:
        st.warning(f"No API key yet. Create one at {provider.key_url}", icon="🔑")
    with st.form(f"key_{pid}", clear_on_submit=True):
        key = st.text_input("API key" if not saved else "Replace API key", type="password",
                            placeholder="Paste your key here")
        save_col, remove_col = st.columns([1, 1])
        if save_col.form_submit_button("Save key", type="primary") and key.strip():
            providers.set_key(pid, key)
            st.rerun()
        if saved and remove_col.form_submit_button("Remove saved key"):
            providers.set_key(pid, None)
            st.rerun()
    st.caption(f"Keys are stored in plain text on this computer in `{providers.config_path()}`. "
               f"Environment variables ({', '.join(f'`{v}`' for v in provider.env_vars)}) also work.")

    # Model
    fetched = st.session_state.get("fetched_models", {}).get(pid, [])
    remembered = (providers.load_config().get("models") or {}).get(pid)
    preferred = current_model if pid == current.id else remembered or provider.models[0]
    options = list(dict.fromkeys([*provider.models, *fetched, preferred])) + [CUSTOM_MODEL]
    choice = st.selectbox("Model", options, index=options.index(preferred))
    model = st.text_input("Model id", placeholder="e.g. gpt-5") if choice == CUSTOM_MODEL else choice
    if st.button("Load available models from the API", disabled=not providers.is_configured(pid)):
        from ai_diving_monitor.agent import describe_api_error, list_models
        try:
            st.session_state.setdefault("fetched_models", {})[pid] = list_models(pid)
            st.rerun()
        except Exception as exc:
            st.error(describe_api_error(exc))

    active = pid == current.id and model == current_model
    if st.button("Use this model", type="primary", disabled=active or not model):
        providers.select(pid, model.strip())
        st.rerun()
    if active:
        st.caption(f"The coach is using **{provider.name}** · `{current_model}`.")


def settings_agent_app(provider: providers.Provider, active: bool) -> None:
    app = AGENT_APPS[provider.id]
    status = providers.agent_app_status(provider.id)
    st.markdown("**Setup**")
    if status.cli_installed:
        st.success(f"{app['app']} is installed. Sign in with your {app['account']}: {app['login']}.", icon="✅")
    else:
        st.warning(f"Install {app['app']} from {provider.key_url}, then sign in with your {app['account']}: "
                   f"{app['login']}.", icon="⬇️")
    if status.mcp_registered:
        st.success(f"The dive log is connected to {app['app']} (MCP server `ai-diving-monitor`).", icon="✅")
    else:
        st.warning(f"Connect the dive log to {app['app']}. Run this in a terminal:", icon="🔌")
        st.code(app["mcp_add"].format(python=sys.executable), language=None)
    if provider.id == "claude-code":
        if status.review_command_installed:
            st.success("The `/dive-review` command is installed.", icon="✅")
        elif REVIEW_COMMAND_SRC.exists():
            st.info("Optional: install the `/dive-review` shortcut for Claude Code.", icon="⚡")
            if st.button("Install /dive-review"):
                target = Path.home() / ".claude" / "commands" / "dive-review.md"
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(REVIEW_COMMAND_SRC, target)
                st.rerun()
        how = "run `/dive-review` or ask questions about your log"
    else:
        how = "ask *“Review my latest dive and save the review”* or any question about your log"
    st.markdown(f"**How to use it:** in {app['app']}, import dives (*“Import my dives from D:\\\\export.uddf”*), "
                f"{how}. Reviews are saved and shown on the **Dive details** page.")
    if active:
        st.caption(f"The coach is set to use your {app['plan']} via {app['app']}.")
    elif st.button(f"Use my {app['plan']}", type="primary"):
        providers.select(provider.id, "")
        st.rerun()


{
    "Dashboard": page_dashboard,
    "Import dives": page_import,
    "Dive log": page_log,
    "Dive details": page_details,
    "AI coach": page_coach,
    "Stored files": page_files,
    "Settings": page_settings,
}[page]()
