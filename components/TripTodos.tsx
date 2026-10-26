"use client";

import { type FormEvent, useState } from "react";
import { api } from "@/components/useLive";
import type { TripTodo } from "@/lib/trip";

/**
 * What is still to sort out before the trip: your companion's list (questions for the dive centre,
 * gear, a course) and your own. Tick them off here; the next preparation sees what you did.
 */
export function TripTodos({ tripId, todos, cards, onChange }: { tripId: string; todos: TripTodo[]; cards: { itemId: string; title: string }[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [card, setCard] = useState("");

  async function call(method: string, body: unknown) {
    setBusy(true);
    setFailure(null);
    try {
      await api(`/api/trips/${tripId}/todos`, method, body);
      onChange();
      return true;
    } catch (err) {
      setFailure((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await call("POST", { text, ...(card ? { itemId: card } : {}) })) {
      setText("");
      setCard("");
    }
  }

  const title = (itemId?: string) => cards.find((c) => c.itemId === itemId)?.title;
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const item = (t: TripTodo) => (
    <li key={t.id} className={t.done ? "done" : undefined}>
      <label>
        <input type="checkbox" checked={t.done} disabled={busy} onChange={(e) => call("PATCH", { id: t.id, done: e.target.checked })} />
        <span>{t.text}</span>
      </label>
      {t.itemId && title(t.itemId) && (
        <a className="todo-card" href={`#card-${t.itemId}`}>
          {title(t.itemId)}
        </a>
      )}
      {t.by === "diver" && (
        <button type="button" className="todo-remove" aria-label={`Remove "${t.text}"`} disabled={busy} onClick={() => call("DELETE", { id: t.id })}>
          ×
        </button>
      )}
    </li>
  );

  return (
    <section className="card stack" id="todos" aria-labelledby="todos-h">
      <div className="chart-head">
        <h2 id="todos-h" style={{ margin: 0 }}>
          To sort out
        </h2>
        <span className="muted">{open.length ? `${open.length} open${done.length ? ` · ${done.length} done` : ""}` : todos.length ? "All done" : ""}</span>
      </div>
      {todos.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Nothing yet. Your companion adds what to ask the dive centre or bring when it prepares the trip; add your own below.
        </p>
      )}
      {open.length > 0 && <ul className="todos">{open.map(item)}</ul>}
      {done.length > 0 && (
        <details>
          <summary className="muted">{done.length} done</summary>
          <ul className="todos">{done.map(item)}</ul>
        </details>
      )}
      <form className="row todo-add" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a to-do, e.g. Buy a new SMB" aria-label="New to-do" maxLength={300} />
        {cards.length > 0 && (
          <select value={card} onChange={(e) => setCard(e.target.value)} aria-label="About a dive card">
            <option value="">Whole trip</option>
            {cards.map((c) => (
              <option key={c.itemId} value={c.itemId}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        <button className="button" type="submit" disabled={busy || !text.trim()}>
          Add
        </button>
      </form>
      {failure && <div className="error">{failure}</div>}
    </section>
  );
}
