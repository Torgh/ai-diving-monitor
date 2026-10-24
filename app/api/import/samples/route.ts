import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, readBody } from "@/lib/server/http";

/** Loads the fictional sample log in examples/ (a diver's progression from spring to autumn). */
export const POST = handle(async (req) => {
  assertLocal(req);
  await readBody(req, z.object({}));
  const dir = path.join(process.cwd(), "examples");
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".uddf")).sort();
  const store = new DiveStore();
  let added = 0;
  for (const name of names) added += (await store.importFile(name, new Uint8Array(await fs.readFile(path.join(dir, name))))).added.length;
  return { added };
});
