import { z } from "zod";
import { resolveDive, SUMMARY_REQUEST } from "@/lib/coach";
import { describeApiError, runCoach } from "@/lib/server/coachAgent";
import { selected } from "@/lib/server/config";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { KitStore } from "@/lib/server/kitStore";

/** Asks the in-app coach for a review of one dive and saves it with the dive. */
export const POST = handle(async (req) => {
  assertLocal(req);
  const { diveId } = await readBody(req, z.object({ diveId: z.string().min(1) }));
  const store = new DiveStore();
  const { record, seq } = resolveDive(await store.list(), diveId);
  const { provider, model } = selected();
  const request = `${SUMMARY_REQUEST.replace("{dive}", `#${seq} (id ${record.id})`)}\n\nUse your tools: the dive's analysis, its profile when the shape matters, and my history and progress trends.`;
  let answer;
  try {
    answer = await runCoach(provider.id, model, [{ role: "user", content: request }], { records: () => store.list(), kit: () => new KitStore(store.backend).get(), dataFolder: store.backend.location });
  } catch (err) {
    throw describeApiError(err) ?? err;
  }
  // A declined, cut-off or empty answer is shown, never saved over the dive's review.
  if (!answer.complete) throw new HttpError(502, `The review wasn't saved: ${answer.text}`);
  await store.saveReview(record.id, answer.text);
  return { review: answer.text };
});
