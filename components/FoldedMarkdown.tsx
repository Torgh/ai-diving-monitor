"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitSections } from "@/lib/sections";

/** Markdown with each main section folded, the first one open; short texts are shown whole. */
export function FoldedMarkdown({ markdown }: { markdown: string }) {
  const split = splitSections(markdown);
  const [open, setOpen] = useState<boolean[]>(() => split?.sections.map((_, i) => i === 0) ?? []);
  if (!split) return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>;
  const all = open.every(Boolean);
  return (
    <div className="folded">
      {split.intro && <ReactMarkdown remarkPlugins={[remarkGfm]}>{split.intro}</ReactMarkdown>}
      <div className="fold-bar">
        <span className="muted">{split.sections.length} sections</span>
        <button type="button" className="fold-all" aria-expanded={all} onClick={() => setOpen(split.sections.map(() => !all))}>
          {all ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {split.sections.map((section, i) => (
        <details
          key={`${i}${section.title}`}
          open={open[i] ?? false}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setOpen((now) => (now[i] === isOpen ? now : now.map((o, j) => (j === i ? isOpen : o))));
          }}
        >
          <summary>{section.title}</summary>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown>
        </details>
      ))}
    </div>
  );
}
