"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/dives", label: "Dive log" },
  { href: "/trips", label: "Trips" },
  { href: "/import", label: "Import dives" },
  { href: "/coach", label: "AI coach" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  const current = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" className="brand">
        🤿 AI Diving Monitor
      </Link>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="link" aria-current={current(l.href) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
      <p className="live">Updates live when your coach in Claude Code or Codex changes the log.</p>
    </nav>
  );
}
