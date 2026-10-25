import { z } from "zod";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { TripStore } from "@/lib/server/tripStore";

type Ctx = { params: Promise<{ id: string }> };

const change = z.object({ itemId: z.string().min(1).max(64), diveId: z.string().min(1).max(128), linked: z.boolean() });

/** Links a logged dive to a dive card of the trip, or unlinks it. A dive belongs to one card at most. */
export const POST = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const { itemId, diveId, linked } = await readBody(req, change);
  const dives = new DiveStore();
  if (linked && !(await dives.get(diveId))) throw new HttpError(404, `No dive with id ${diveId}.`);
  const trips = new TripStore(dives.backend);
  const plan = await trips.get(id);
  if (!plan) throw new HttpError(404, `No saved trip with id ${id}.`);
  if (!plan.dives.some((d) => d.itemId === itemId)) throw new HttpError(404, `The trip has no dive card ${itemId}.`);
  const saved = await trips.update(id, (p) => {
    for (const card of p.dives) {
      card.loggedDiveIds = card.loggedDiveIds.filter((d) => d !== diveId);
      if (linked && card.itemId === itemId) card.loggedDiveIds.push(diveId);
    }
  });
  return { loggedDiveIds: saved.dives.find((d) => d.itemId === itemId)!.loggedDiveIds };
});
