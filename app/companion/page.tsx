"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/components/useLive";
import { useSettings } from "@/components/useSettings";

type Message = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "Debrief my latest dive.",
  "Is my gas consumption improving?",
  "What should I practise before my next deep dive?",
  "What is still missing in my dive log?",
];

export default function CompanionPage() {
  const { settings, error } = useSettings();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (error) return <div className="error">{error}</div>;
  if (!settings) return <p className="muted">Loading…</p>;
  const provider = settings.providers.find((p) => p.id === settings.provider)!;

  if (!provider.usesApi) {
    return (
      <div className="stack">
        <h1>Companion</h1>
        <div className="card stack">
          <p>
            Your companion runs in <strong>{provider.app}</strong> on your {provider.plan}. Ask there, for example:
          </p>
          <ul>
            <li>
              <code>/mcp__divedeck__dive-review</code>: a debrief of your latest dive, saved here
            </li>
            <li>
              <code>/mcp__divedeck__sort-out</code>: go through what your log is still missing
            </li>
            <li>“Is my gas consumption improving? What should I practise before my next deco dive?”</li>
          </ul>
          <p className="muted">
            Debriefs and the details your companion fills in show up in this app within seconds. To chat here instead, choose an API key in{" "}
            <Link href="/settings">Settings</Link>.
          </p>
        </div>
      </div>
    );
  }

  if (!provider.key) {
    return (
      <div className="stack">
        <h1>Companion</h1>
        <div className="notice">
          Add your {provider.name} in <Link href="/settings">Settings</Link> to talk to your companion here, or choose your Claude or ChatGPT subscription
          there to ask in Claude Code or Codex instead.
        </div>
      </div>
    );
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setFailure(null);
    try {
      const { answer } = await api<{ answer: string }>("/api/coach", "POST", { messages: next });
      setMessages([...next, { role: "assistant", content: answer }]);
    } catch (err) {
      setFailure((err as Error).message);
      setMessages(messages);
      setDraft(content);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Companion</h1>
        <span className="muted">
          {provider.name} · <code>{settings.model}</code> · billed per use
        </span>
      </div>
      {messages.length === 0 && (
        <div className="row">
          {STARTERS.map((s) => (
            <button key={s} className="button" disabled={busy} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {messages.map((m, i) => (
        <div key={i} className={m.role === "assistant" ? "card review" : "notice"}>
          {m.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown> : m.content}
        </div>
      ))}
      {busy && <p className="muted">Your companion is reading your log…</p>}
      {failure && <div className="error">{failure}</div>}
      <form className="form" onSubmit={submit}>
        <label className="wide">
          Ask your companion
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
        </label>
        <div className="row wide">
          <button className="button primary" type="submit" disabled={busy || !draft.trim()}>
            Send
          </button>
          {messages.length > 0 && (
            <button className="button" type="button" disabled={busy} onClick={() => setMessages([])}>
              New conversation
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
