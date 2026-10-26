import { buildExport, exportFileName } from "@/lib/exportFile";
import { units } from "@/lib/server/config";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle } from "@/lib/server/http";
import { KitStore } from "@/lib/server/kitStore";
import { TripStore } from "@/lib/server/tripStore";

/** The whole log as one `.divedeck.json` file to download, for the phone app. */
export const GET = handle(async (req) => {
  assertLocal(req);
  const [dives, trips, kit] = await Promise.all([new DiveStore().list(), new TripStore().list(), new KitStore().get()]);
  const now = new Date().toISOString();
  return new Response(JSON.stringify(buildExport({ dives, trips, kit, units: units() }, now)), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(now)}"`,
      "cache-control": "no-store",
    },
  });
});
