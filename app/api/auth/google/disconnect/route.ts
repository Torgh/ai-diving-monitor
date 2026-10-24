import { z } from "zod";
import { activeStorage } from "@/lib/server/backends";
import { disconnect } from "@/lib/server/cloudAuth";
import { assertLocal, handle, readBody } from "@/lib/server/http";
import { switchStorage } from "@/lib/server/storage";

/** Signs out of Google. If Drive held the log, it is copied to this PC first (and stays on Drive). */
export const POST = handle(async (req) => {
  assertLocal(req);
  await readBody(req, z.object({}));
  const copied = activeStorage() === "google" ? await switchStorage("local") : 0;
  await disconnect();
  return { ok: true, copied };
});
