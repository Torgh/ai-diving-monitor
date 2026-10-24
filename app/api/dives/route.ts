import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle } from "@/lib/server/http";
import { dataDir } from "@/lib/server/paths";
import { logVersion } from "@/lib/server/version";
import { logView } from "@/lib/views";

export const GET = handle(async (req) => {
  assertLocal(req);
  const version = await logVersion();
  return { version, dataFolder: dataDir(), ...logView(await new DiveStore().list()) };
});
