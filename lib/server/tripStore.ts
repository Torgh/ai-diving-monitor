import { assertTripId, mergeTripPlan, TRIP_FORMAT, tripFileName, type TripPlan, type TripPlanInput } from "../trip";
import { activeBackend, type Backend, type StoredFile } from "./backends";
import { withLock } from "./files";

const now = () => new Date().toISOString();
/** The id becomes part of the lock file name, so it is checked first. */
const lockName = (id: string) => {
  assertTripId(id);
  return `trip-${id}`;
};

/**
 * The trips being prepared for: one `*.trip.json` file per TripDeck trip, next to the dive files,
 * wherever the log is stored. Shared by the MCP server and the web app.
 */
export class TripStore {
  constructor(readonly backend: Backend = activeBackend()) {}

  private async files(): Promise<{ file: StoredFile; plan: TripPlan }[]> {
    const files = (await this.backend.list("trips")).filter((f) => f.name.endsWith(".trip.json"));
    const out = await Promise.all(
      files.map(async (file) => {
        try {
          const data = await this.backend.read("trips", file.name);
          const json = data && JSON.parse(new TextDecoder().decode(data));
          return { file, plan: json?.format === TRIP_FORMAT ? (json as TripPlan) : null };
        } catch {
          return { file, plan: null }; // not a trip file, or half-written by another program
        }
      }),
    );
    return out.filter((e): e is { file: StoredFile; plan: TripPlan } => e.plan !== null);
  }

  /** Every trip, the next one first: by start date, undated last. A trip saved twice counts once (the newer). */
  async list(): Promise<TripPlan[]> {
    const newest = new Map<string, TripPlan>();
    for (const { plan } of await this.files()) {
      const seen = newest.get(plan.id);
      if (!seen || plan.updatedAt > seen.updatedAt) newest.set(plan.id, plan);
    }
    return [...newest.values()].sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<TripPlan | undefined> {
    return (await this.list()).find((p) => p.id === id);
  }

  /** Writes the plan under its current name and removes its other files (an old name after a rename, a conflict copy). */
  private async write(plan: TripPlan): Promise<void> {
    const name = tripFileName(plan);
    const others = (await this.files()).filter((e) => e.plan.id === plan.id && e.file.name !== name);
    await this.backend.write("trips", name, JSON.stringify(plan, null, 1) + "\n");
    for (const e of others) await this.backend.remove("trips", e.file.name);
  }

  /** Saves the trip's dive cards as TripDeck has them now, keeping the preparation of cards that stay. */
  async save(input: TripPlanInput): Promise<TripPlan> {
    return withLock(lockName(input.id), async () => {
      const plan = mergeTripPlan(await this.get(input.id), input, now());
      await this.write(plan);
      return plan;
    });
  }

  /** Changes a saved trip under its lock. */
  async update(id: string, change: (plan: TripPlan) => void): Promise<TripPlan> {
    return withLock(lockName(id), async () => {
      const plan = await this.get(id);
      if (!plan) throw new Error(`No saved trip with id ${id}. Save it with save_trip_plan first.`);
      change(plan);
      plan.updatedAt = now();
      await this.write(plan);
      return plan;
    });
  }

  async delete(id: string): Promise<boolean> {
    return withLock(lockName(id), async () => {
      const files = (await this.files()).filter((e) => e.plan.id === id);
      for (const e of files) await this.backend.remove("trips", e.file.name);
      return files.length > 0;
    });
  }

  /** Copies a plan as it is (another store's copy). */
  async put(plan: TripPlan): Promise<void> {
    await withLock(lockName(plan.id), () => this.write(plan));
  }
}

/** Copies the trips to another place: the ones it doesn't have or has in an older version. */
export async function copyTrips(from: TripStore, to: TripStore): Promise<{ trips: number }> {
  const theirs = new Map((await to.list()).map((p) => [p.id, p.updatedAt]));
  let trips = 0;
  for (const plan of await from.list()) {
    const seen = theirs.get(plan.id);
    if (seen && seen >= plan.updatedAt) continue;
    await to.put(plan);
    trips++;
  }
  return { trips };
}
