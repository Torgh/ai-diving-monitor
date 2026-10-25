import { z } from "zod";
import { parseGas } from "@/lib/record";
import { DiveStore } from "@/lib/server/diveStore";
import { KitStore } from "@/lib/server/kitStore";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { logVersion } from "@/lib/server/version";
import { diveView } from "@/lib/views";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const version = await logVersion();
  const view = diveView(await new DiveStore().list(), id);
  if (!view) throw new HttpError(404, `No dive with id ${id}.`);
  return { version, ...view };
});

const text = z.string().max(2000).nullable().optional();
const detailsPatch = z.object({
  site: text,
  location: text,
  buddy: text,
  notes: text,
  tankVolumeL: z.number().positive().max(100).nullable().optional(),
  gas: z.string().max(40).nullable().optional(),
  gearSetId: z.string().max(60).nullable().optional(),
  ballastKg: z.number().min(0).max(40).nullable().optional(),
  water: z.enum(["fresh", "brackish", "salt"]).nullable().optional(),
  weighting: z.enum(["light", "ok", "heavy"]).nullable().optional(),
});

/** Fills in or changes what the computer didn't record; null or "" removes a field. */
export const PATCH = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const patch = await readBody(req, detailsPatch);
  let gas: { o2: number; he: number } | null | undefined = patch.gas === undefined ? undefined : null;
  if (patch.gas) {
    gas = parseGas(patch.gas);
    if (!gas) throw new HttpError(400, `Can't read the gas "${patch.gas}". Write it like air, EAN32, oxygen or Tx 18/45.`);
  }
  if (patch.gearSetId && !(await new KitStore().get()).sets.some((s) => s.id === patch.gearSetId))
    throw new HttpError(400, `No gear set with id "${patch.gearSetId}". Make it on the Gear page first.`);
  const record = await new DiveStore().updateDetails(id, { ...patch, gas });
  return { details: record.details };
});
