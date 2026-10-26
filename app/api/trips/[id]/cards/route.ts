import { z } from "zod";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { TripStore } from "@/lib/server/tripStore";
import { setCardSite, TripInputError } from "@/lib/trip";

type Ctx = { params: Promise<{ id: string }> };

const change = z.object({ itemId: z.string().min(1).max(64), siteId: z.string().min(1).max(80).nullable() });

/** Sets which proposed site a dive card dives: a site id, "none", or null to find it by name again. */
export const POST = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const { itemId, siteId } = await readBody(req, change);
  const trips = new TripStore();
  if (!(await trips.get(id))) throw new HttpError(404, `No saved trip with id ${id}.`);
  try {
    const plan = await trips.update(id, (p) => setCardSite(p, itemId, siteId));
    return { siteId: plan.dives.find((d) => d.itemId === itemId)!.siteId ?? null };
  } catch (err) {
    if (err instanceof TripInputError) throw new HttpError(404, err.message);
    throw err;
  }
});
