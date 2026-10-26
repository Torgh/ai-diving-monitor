"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useKeptCopy } from "./Offline";

/** 24×24 stroke icons, drawn in the link's text colour. */
const ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  log: <path d="M3 5 L7 17 H13 L15 10 H18 L19 6" />,
  trips: (
    <>
      <path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  import: <path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />,
  companion: <path d="M4 5h16v11H9l-5 4z" />,
  gear: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M8 9h8l-1 12H9z" />
      <path d="M9 13h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
};

const LINKS = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/dives", label: "Dive log", icon: "log" },
  { href: "/trips", label: "Trips", icon: "trips" },
  { href: "/gear", label: "Gear", icon: "gear" },
  { href: "/import", label: "Import", icon: "import" },
  { href: "/companion", label: "Companion", icon: "companion" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

type Storage = { active: "local" | "onedrive" | "google"; location: string };

/** Where the log is kept, short enough for the menu; the full place is in the tooltip. */
function storageLabel(s: Storage) {
  if (s.active === "google") return s.location;
  return s.active === "onedrive" ? "OneDrive" : "This computer";
}

export function Nav() {
  const path = usePathname();
  const current = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const [storage, setStorage] = useState<Storage | null>(null);
  const kept = useKeptCopy();

  useEffect(() => {
    fetch("/api/storage", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(setStorage)
      .catch(() => setStorage(null));
  }, []);

  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" className="brand">
        {/* A small static SVG: next/image would not optimise it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-small.svg" alt="" width={32} height={32} />
        DiveDeck
      </Link>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="link" aria-current={current(l.href) ? "page" : undefined}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[l.icon]}
          </svg>
          {l.label}
        </Link>
      ))}
      <div className={`live ${kept ? "offline" : ""}`} title={kept ? "Your log can't be reached: showing what was kept." : "Updates live when your companion in Claude Code or Codex changes the log."}>
        <span className="status">
          <span className={`dot ${kept ? "warning" : "good"}`} />
          <strong>{kept ? "Offline" : "Live"}</strong>
        </span>
        {storage && <span title={storage.location}>{storageLabel(storage)}</span>}
      </div>
    </nav>
  );
}
