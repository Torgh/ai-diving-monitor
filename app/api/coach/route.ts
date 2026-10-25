import { z } from "zod";
import { describeApiError, runCoach } from "@/lib/server/coachAgent";
import { selected } from "@/lib/server/config";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, readBody } from "@/lib/server/http";
import { TripStore } from "@/lib/server/tripStore";
import { KitStore } from "@/lib/server/kitStore";

const chat = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20_000) }))
    .min(1)
    .max(60)
    .refine((m) => m[m.length - 1].role === "user", "The last message must be the diver's."),
});

/** One turn of the conversation with the in-app coach (API key mode). */
export const POST = handle(async (req) => {
  assertLocal(req);
  const { messages } = await readBody(req, chat);
  const { provider, model } = selected();
  const store = new DiveStore();
  try {
    const { text } = await runCoach(provider.id, model, messages, {
      records: () => store.list(),
      trips: () => new TripStore(store.backend).list(),
      kit: () => new KitStore(store.backend).get(),
      dataFolder: store.backend.location,
    });
    return { answer: text };
  } catch (err) {
    throw describeApiError(err) ?? err;
  }
});
