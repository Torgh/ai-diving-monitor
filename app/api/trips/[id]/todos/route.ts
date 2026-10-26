import { z } from "zod";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { TripStore } from "@/lib/server/tripStore";
import { addTodo, removeTodo, setTodoDone, type TripPlan, TripInputError, type TripTodo } from "@/lib/trip";

type Ctx = { params: Promise<{ id: string }> };

/** Runs a change on the trip's to-dos; a missing trip, to-do or card is a 404. */
async function change(id: string, fn: (plan: TripPlan) => TripTodo | void) {
  const trips = new TripStore();
  if (!(await trips.get(id))) throw new HttpError(404, `No saved trip with id ${id}.`);
  let result: TripTodo | void = undefined;
  try {
    await trips.update(id, (p) => {
      result = fn(p);
    });
  } catch (err) {
    if (err instanceof TripInputError) throw new HttpError(err.message.startsWith("A to-do needs") ? 400 : 404, err.message);
    throw err;
  }
  return result ?? { removed: true };
}

const added = z.object({ text: z.string().min(1).max(300), itemId: z.string().min(1).max(64).optional() });
const ticked = z.object({ id: z.string().min(1).max(20), done: z.boolean() });
const removed = z.object({ id: z.string().min(1).max(20) });

/** The diver adds a to-do of their own. */
export const POST = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const { text, itemId } = await readBody(req, added);
  return change(id, (p) => addTodo(p, text, itemId, new Date().toISOString()));
});

/** Ticks a to-do off, or back on. */
export const PATCH = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const { id: todo, done } = await readBody(req, ticked);
  return change(id, (p) => setTodoDone(p, todo, done, new Date().toISOString()));
});

export const DELETE = handle(async (req, { params }: Ctx) => {
  assertLocal(req);
  const { id } = await params;
  const { id: todo } = await readBody(req, removed);
  return change(id, (p) => removeTodo(p, todo));
});
