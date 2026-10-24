import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle } from "@/lib/server/http";
import { logVersion } from "@/lib/server/version";
import { logView } from "@/lib/views";

export const GET = handle(async (req) => {
  assertLocal(req);
  const version = await logVersion();
  const store = new DiveStore();
  return { version, dataFolder: store.backend.location, ...logView(await store.list()) };
});
