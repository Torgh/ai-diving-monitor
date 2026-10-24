import fs from "node:fs";
import { z } from "zod";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { pythonDbPath } from "@/lib/server/paths";

/** Whether the Python version's database is there to migrate. */
export const GET = handle(async (req) => {
  assertLocal(req);
  const database = pythonDbPath();
  return { database, available: fs.existsSync(database) };
});

/** Copies the Python version's log into the dive files (safe to run again). */
export const POST = handle(async (req) => {
  assertLocal(req);
  await readBody(req, z.object({}));
  const database = pythonDbPath();
  if (!fs.existsSync(database)) throw new HttpError(404, `No database at ${database}.`);
  const { migrateFromPython } = await import("@/lib/server/migrate");
  return migrateFromPython(new DiveStore(), database);
});
