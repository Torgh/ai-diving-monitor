"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/components/useLive";
import { useSettings } from "@/components/useSettings";
import { Command } from "@/components/Command";

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
  const end = useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);

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
              <Command text="/mcp__divedeck__dive-review" />: a debrief of your latest dive, saved here
            </li>
            <li>
              <Command text="/mcp__divedeck__sort-out" />: go through what your log is still missing
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
      <div className="page-head">
        <h1>Companion</h1>
        <span className="muted">
          {provider.name} · <code>{settings.model}</code> · billed per use
        </span>
      </div>
      {messages.length === 0 && (
        <div className="stack" style={{ gap: "0.6rem" }}>
          <p className="secondary" style={{ margin: 0 }}>
            Ask about your dives. Your companion reads your log through the same tools as in Claude Code, so its answers rest on your numbers.
          </p>
          <div className="chips">
            {STARTERS.map((s) => (
              <button key={s} type="button" className="chip" disabled={busy} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="chat" aria-live="polite">
        {messages.map((m, i) =>
          m.role === "assistant" ? (
            <div key={i} className="bubble assistant review">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
            </div>
          ) : (
            <div key={i} className="bubble user">
              {m.content}
            </div>
          ),
        )}
        {busy && <p className="typing">Your companion is reading your log…</p>}
        <div ref={end} />
      </div>
      {failure && <div className="error">{failure}</div>}
      <form className="composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="ask">
          Ask your companion
        </label>
        <textarea
          id="ask"
          rows={2}
          value={draft}
          placeholder="Ask your companion… (Enter sends, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        <button className="button primary" type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
        {messages.length > 0 && (
          <button className="button" type="button" disabled={busy} onClick={() => setMessages([])}>
            New
          </button>
        )}
      </form>
    </div>
  );
}
