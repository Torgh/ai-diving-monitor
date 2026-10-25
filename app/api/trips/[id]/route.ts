import { z } from "zod";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { TripStore } from "@/lib/server/tripStore";
import { logVersion } from "@/lib/server/version";
import { tripView } from "@/lib/tripViews";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const version = await logVersion();
  const store = new DiveStore();
  const view = tripView(await new TripStore(store.backend).list(), await store.list(), id);
  if (!view) throw new HttpError(404, `No saved trip with id ${id}.`);
  return { version, ...view };
});

/** Forgets the trip here (its preparation and links); TripDeck keeps the trip. */
export const DELETE = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  await readBody(req, z.object({}));
  const { id } = await params;
  if (!(await new TripStore().delete(id))) throw new HttpError(404, `No saved trip with id ${id}.`);
  return { deleted: true };
});
