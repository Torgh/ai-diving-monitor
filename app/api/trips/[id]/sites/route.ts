import { z } from "zod";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { TripStore } from "@/lib/server/tripStore";
import { chooseSites, TripInputError } from "@/lib/trip";

type Ctx = { params: Promise<{ id: string }> };

const change = z.object({ siteId: z.string().min(1).max(80), status: z.enum(["proposed", "chosen", "dropped"]) });

/** The diver chooses a proposed dive site, drops it, or puts it back among the proposals. */
export const POST = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const { siteId, status } = await readBody(req, change);
  const trips = new TripStore();
  if (!(await trips.get(id))) throw new HttpError(404, `No saved trip with id ${id}.`);
  try {
    const plan = await trips.update(id, (p) => chooseSites(p, { [status]: [siteId] }));
    return { status: plan.sites!.find((s) => s.id === siteId)!.status };
  } catch (err) {
    if (err instanceof TripInputError) throw new HttpError(404, err.message);
    throw err;
  }
});
