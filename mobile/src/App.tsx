import { App as NativeApp } from "@capacitor/app";
import { useEffect, useMemo, useRef, useState } from "react";
import { Glyph } from "@/components/NavIcons";
import { UnitsProvider } from "@/components/Units";
import { type DiveDeckExport, readExport } from "@/lib/exportFile";
import { formatDate } from "@/lib/format";
import { tripsView } from "@/lib/tripViews";
import { logView } from "@/lib/views";
import { DiveScreen, FileScreen, Home, localTime, LogScreen, TripsScreen, Welcome } from "./screens";
import { forgetLog, loadLog, saveLog } from "./storage";
import { go, useHashPath } from "./useHashPath";

const TABS = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/dives", label: "Dive log", icon: "log" },
  { href: "/trips", label: "Trips", icon: "trips" },
  { href: "/file", label: "Your file", icon: "import" },
];

export function App() {
  // undefined while the stored log is read, null when nothing is imported yet.
  const [log, setLog] = useState<DiveDeckExport | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  // Re-read on resume so "in 3 days" moves on when the app was left open overnight.
  const [now, setNow] = useState(() => new Date());
  const path = useHashPath();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadLog().then(setLog);
  }, []);

  // Android back button: back through the screens opened, out of the app from the dashboard.
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);
  useEffect(() => {
    const back = NativeApp.addListener("backButton", () => {
      if (pathRef.current === "/") void NativeApp.exitApp();
      else history.back();
    });
    const resume = NativeApp.addListener("resume", () => setNow(new Date()));
    return () => {
      void back.then((h) => h.remove());
      void resume.then((h) => h.remove());
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const views = useMemo(() => (log ? { log: logView(log.dives), trips: tripsView(log.trips, now) } : null), [log, now]);

  async function importFile(file: File) {
    try {
      const next = readExport(JSON.parse(await file.text()));
      await saveLog(next);
      setLog(next);
      setNotice(`Imported ${next.dives.length} dive${next.dives.length === 1 ? "" : "s"} and ${next.trips.length} trip${next.trips.length === 1 ? "" : "s"}`);
      go("/");
    } catch (e) {
      setNotice(e instanceof SyntaxError ? "This file is not valid JSON." : (e as Error).message);
    }
  }

  async function forget() {
    await forgetLog();
    setLog(null);
    go("/");
  }

  if (log === undefined) return <div className="splash" />;
  const pickFile = () => fileInput.current?.click();
  const current = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  let screen: React.ReactNode;
  if (!log || !views) screen = <Welcome onImport={pickFile} />;
  else if (path.startsWith("/dives/")) screen = <DiveScreen records={log.dives} id={decodeURIComponent(path.slice("/dives/".length))} />;
  else if (path === "/dives") screen = <LogScreen log={views.log} />;
  else if (path === "/trips") screen = <TripsScreen trips={views.trips.trips} />;
  else if (path === "/file") screen = <FileScreen log={log} onImport={pickFile} onForget={forget} />;
  else screen = <Home log={views.log} next={views.trips.next} />;

  return (
    <UnitsProvider fixed={log?.units ?? "metric"}>
      <div className="app">
        <header className="topbar">
          <a href="#/" className="brand">
            <img src="./icon.svg" alt="" width={32} height={32} />
            DiveDeck
          </a>
          {log && (
            <div className="live">
              <span className="status">
                <span className="dot good" />
                <strong>Offline</strong>
              </span>
              <span>exported {formatDate(localTime(log.exportedAt), false)}</span>
            </div>
          )}
        </header>
        {log && (
          <nav className="nav" aria-label="Main">
            {TABS.map((t) => (
              <a key={t.href} href={`#${t.href}`} className="link" aria-current={current(t.href) ? "page" : undefined}>
                <Glyph icon={t.icon} />
                {t.label}
              </a>
            ))}
          </nav>
        )}
        <main className="page">{screen}</main>
      </div>
      {/* No `accept`: cloud apps often hand over .divedeck.json files without a JSON type. */}
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </UnitsProvider>
  );
}
