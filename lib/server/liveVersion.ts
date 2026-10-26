import { existsSync, type FSWatcher, watch } from "node:fs";
import { activeBackend, type Backend } from "./backends";
import { logVersion } from "./version";

type Listener = (version: string) => void;

interface Options {
  /** Where the log is; asked again on every check, so a storage switch in Settings is followed. */
  backend?: () => Backend;
  /** A watched folder is still checked this often, in case an event was missed. */
  folderMs?: number;
  /** Google Drive can't be watched: checked this often, once for every open page. */
  driveMs?: number;
  /** A write is a temp file and a rename: one check this long after the first event. */
  debounceMs?: number;
}

/**
 * Tells the open pages when the log changes, by the app or by the MCP server. A folder on this PC
 * (OneDrive's too) is watched, so a change shows within a moment; Google Drive is checked every few
 * seconds. It runs only while a page listens.
 */
export class LiveVersion {
  private listeners = new Set<Listener>();
  private current: string | null = null;
  private watcher: FSWatcher | null = null;
  private watched: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;
  private again = false;
  private readonly backend: () => Backend;
  private readonly folderMs: number;
  private readonly driveMs: number;
  private readonly debounceMs: number;

  constructor(options: Options = {}) {
    this.backend = options.backend ?? activeBackend;
    this.folderMs = options.folderMs ?? 30_000;
    this.driveMs = options.driveMs ?? 5_000;
    this.debounceMs = options.debounceMs ?? 150;
  }

  /** Calls `listener` with each new version; the returned function stops it. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) void this.check();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  }

  /** Checks now; a change during a check runs one more after it. */
  check(): Promise<void> {
    if (this.checking) {
      this.again = true;
      return this.checking;
    }
    this.checking = (async () => {
      do {
        this.again = false;
        const backend = this.backend();
        this.follow(backend);
        const version = await logVersion(backend).catch(() => null); // Drive unreachable: try again later
        if (version !== null && version !== this.current && this.listeners.size) {
          this.current = version;
          for (const listener of this.listeners) listener(version);
        }
      } while (this.again && this.listeners.size);
    })().finally(() => {
      this.checking = null;
      this.schedule();
    });
    return this.checking;
  }

  /** Watches the folder the log is in, or nothing on Google Drive. */
  private follow(backend: Backend) {
    const folder = backend.kind === "google" ? null : backend.location;
    if (folder === this.watched && (this.watcher || !folder)) return;
    this.unwatch();
    this.watched = folder;
    // No folder yet (nothing imported): the timer checks often until there is one. Linux doesn't
    // refuse a missing folder at once but reports an error later, hence the check first.
    if (!folder || !existsSync(folder)) return;
    try {
      this.watcher = watch(folder, { recursive: true }, () => this.soon());
      this.watcher.on("error", () => {
        this.unwatch();
        this.schedule(); // back to checking often until the folder can be watched again
      });
    } catch {
      this.watcher = null;
    }
  }

  /** Not pushed back by later events, so a long run of writes (an import) still shows as it goes. */
  private soon() {
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.check();
    }, this.debounceMs);
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = this.listeners.size ? setTimeout(() => void this.check(), this.watcher ? this.folderMs : this.driveMs) : null;
  }

  private unwatch() {
    this.watcher?.close();
    this.watcher = null;
    this.watched = null;
  }

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = this.debounce = null;
    this.unwatch();
    this.current = null;
  }
}

/** One for the server, kept across hot reloads in development so watchers aren't left behind. */
const global = globalThis as { divedeckLiveVersion?: LiveVersion };
export const liveVersion = (global.divedeckLiveVersion ??= new LiveVersion());
