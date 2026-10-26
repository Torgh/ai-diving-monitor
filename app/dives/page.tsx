"use client";

import Link from "next/link";
import { DiveList } from "@/components/DiveList";
import { useLive } from "@/components/useLive";
import type { LogView } from "@/lib/views";

type Data = LogView & { version: string; dataFolder: string };

export default function DiveLog() {
  const { data, error, loading } = useLive<Data>("/api/dives");
  if (error && !data) return <div className="error">Couldn&apos;t load the dive log: {error}</div>;
  if (!data) return <p className="muted">Loading the dive log…</p>;

  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Dive log</h1>
        <Link className="button primary" href="/import">
          Import dives
        </Link>
      </div>
      {!data.dives.length ? (
        <div className="notice">
          No dives yet. <Link href="/import">Import your dives</Link>.
        </div>
      ) : (
        <>
          <DiveList log={data} />
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {data.dives.length} dives · {data.dataFolder}
          </p>
        </>
      )}
    </div>
  );
}
