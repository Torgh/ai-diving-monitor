import { emptyKit, type Kit, type KitChange, readKit, updateKit } from "../kit";
import { activeBackend, type Backend } from "./backends";
import { withLock } from "./files";

const FILE = "kit.json";
const LOCK = "kit";

/**
 * The diver's kit (body, gear, sets, the water at each site): one `kit.json` next to the log, wherever
 * it is stored. Shared by the MCP server and the web app.
 */
export class KitStore {
  constructor(readonly backend: Backend = activeBackend()) {}

  async get(): Promise<Kit> {
    try {
      const data = await this.backend.read("kit", FILE);
      return data ? readKit(JSON.parse(new TextDecoder().decode(data))) : emptyKit();
    } catch {
      return emptyKit(); // half-written by another program: read again next time
    }
  }

  async update(change: KitChange): Promise<Kit> {
    return withLock(LOCK, async () => {
      const kit = updateKit(await this.get(), change, new Date().toISOString());
      await this.put(kit);
      return kit;
    });
  }

  /** Writes a kit as it is (another store's copy). */
  async put(kit: Kit): Promise<void> {
    await this.backend.write("kit", FILE, JSON.stringify(kit, null, 1) + "\n");
  }
}

/** Copies the kit to another place when it has none or an older one. */
export async function copyKit(from: KitStore, to: KitStore): Promise<boolean> {
  const [mine, theirs] = [await from.get(), await to.get()];
  if (!mine.updatedAt || (theirs.updatedAt && theirs.updatedAt >= mine.updatedAt)) return false;
  await withLock(LOCK, () => to.put(mine));
  return true;
}
