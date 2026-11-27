import { promises as fsp } from "fs";

export interface CursorStore {
  save(key: string, cursor: string): Promise<void>;
  load(key: string): Promise<string | undefined>;
  clear(key?: string): Promise<void>;
  /**
   * Checkpoint the cursor after acknowledged event delivery.
   * Semantically identical to save() in most implementations; exposed as a
   * distinct method so callers can signal "this event was processed" rather
   * than just "update the position".
   * Defaults to save() when not explicitly implemented.
   */
  checkpoint?(key: string, cursor: string): Promise<void>;
}

/** In-memory implementation for SSR, tests, and applications without storage. */
export class MemoryCursorStore implements CursorStore {
  private readonly cursors = new Map<string, string>();
  async save(key: string, cursor: string): Promise<void> { this.cursors.set(key, cursor); }
  async load(key: string): Promise<string | undefined> { return this.cursors.get(key); }
  async clear(key?: string): Promise<void> { key === undefined ? this.cursors.clear() : this.cursors.delete(key); }
  async checkpoint(key: string, cursor: string): Promise<void> { return this.save(key, cursor); }
}

/**
 * localStorage-backed cursor store.
 *
 * It fails fast when storage is unavailable: constructing it without a usable
 * Storage implementation throws a descriptive Error instead of silently holding
 * an `undefined` reference that makes every later call reject with a TypeError.
 */
export class LocalStorageCursorStore implements CursorStore {
  private readonly storage: Storage;

  constructor(storage: Storage | null | undefined = globalThis.localStorage, private readonly prefix = "sorokit:cursor:") {
    if (storage === null || storage === undefined) {
      throw new Error("LocalStorageCursorStore requires a Storage implementation: localStorage is unavailable in this environment. Pass a Storage instance explicitly, or use createCursorStore() / MemoryCursorStore instead.");
    }
    for (const method of ["getItem", "setItem", "removeItem", "key"] as const) {
      const candidate: unknown = storage[method];
      if (typeof candidate !== "function") {
        throw new Error(`LocalStorageCursorStore requires a Storage implementation exposing ${method}(); received ${typeof candidate}.`);
      }
    }
    const length: unknown = storage.length;
    if (typeof length !== "number" || !Number.isFinite(length) || length < 0) {
      throw new Error(`LocalStorageCursorStore requires a Storage implementation whose length is a finite, non-negative number; received ${typeof length} ${String(length)}.`);
    }
    this.storage = storage;
  }
  async save(key: string, cursor: string): Promise<void> { this.storage.setItem(this.prefix + key, cursor); }
  async load(key: string): Promise<string | undefined> { return this.storage.getItem(this.prefix + key) ?? undefined; }
  async clear(key?: string): Promise<void> {
    if (key !== undefined) { this.storage.removeItem(this.prefix + key); return; }
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) { const item = this.storage.key(i); if (item?.startsWith(this.prefix)) keys.push(item); }
    keys.forEach((item) => this.storage.removeItem(item));
  }
  async checkpoint(key: string, cursor: string): Promise<void> { return this.save(key, cursor); }
}

/**
 * File-backed cursor store with atomic writes.
 *
 * Persists cursors to a JSON file so they survive server restarts. Writes are
 * atomic: data is written to a `.tmp` file then renamed into place, so a crash
 * mid-write never leaves a corrupt file.
 *
 * Independent streams should use separate `FileCursorStore` instances (or
 * distinct keys within the same instance) to maintain independent cursors.
 *
 * @example
 * const store = new FileCursorStore("/var/data/sorokit-cursors.json");
 * const emitter = new StreamEventEmitter({ cursorStore: store, cursorKey: "contract-events" });
 *
 * // On startup, resume from the last checkpointed position:
 * const lastCursor = await store.load("contract-events");
 */
export class FileCursorStore implements CursorStore {
  private cursors: Map<string, string> = new Map();
  private initialized = false;

  constructor(private readonly filePath: string) {}

  private async _ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    try {
      const raw = await fsp.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, string>;
      this.cursors = new Map(Object.entries(parsed));
    } catch {
      // File doesn't exist yet or is corrupt — start from an empty state.
      this.cursors = new Map();
    }
    this.initialized = true;
  }

  private async _persist(): Promise<void> {
    const obj = Object.fromEntries(this.cursors.entries());
    const json = JSON.stringify(obj, null, 2);
    const tmp = `${this.filePath}.tmp`;
    await fsp.writeFile(tmp, json, "utf-8");
    // Atomic rename — if the process crashes after writeFile but before rename,
    // the original file is untouched and the .tmp is simply left behind.
    await fsp.rename(tmp, this.filePath);
  }

  async save(key: string, cursor: string): Promise<void> {
    await this._ensureLoaded();
    this.cursors.set(key, cursor);
    await this._persist();
  }

  async load(key: string): Promise<string | undefined> {
    await this._ensureLoaded();
    return this.cursors.get(key);
  }

  async clear(key?: string): Promise<void> {
    await this._ensureLoaded();
    if (key !== undefined) {
      this.cursors.delete(key);
    } else {
      this.cursors.clear();
    }
    await this._persist();
  }

  async checkpoint(key: string, cursor: string): Promise<void> {
    return this.save(key, cursor);
  }
}

/**
 * Factory that returns the most appropriate cursor store for the environment.
 *
 * - Pass a file path string → `FileCursorStore` (Node.js server, durable across restarts)
 * - Pass a `Storage` instance → `LocalStorageCursorStore` (browser)
 * - Pass nothing → `LocalStorageCursorStore` when `localStorage` is available, otherwise `MemoryCursorStore`
 */
export function createCursorStore(storageOrPath?: Storage | string): CursorStore {
  if (typeof storageOrPath === "string") {
    return new FileCursorStore(storageOrPath);
  }
  if (storageOrPath) {
    return new LocalStorageCursorStore(storageOrPath);
  }
  try {
    if (typeof globalThis.localStorage !== "undefined") return new LocalStorageCursorStore(globalThis.localStorage);
  } catch {
    // Reading localStorage can itself throw (a privacy-mode getter raising
    // SecurityError, for example). Fall through to the in-memory store.
  }
  return new MemoryCursorStore();
}

export interface EventDeduplicationStore {
  has(id: string): Promise<boolean>;
  add(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Persistent bounded event IDs prevent duplicate delivery after reconnects. */
export class PersistentEventDeduplicationStore implements EventDeduplicationStore {
  private readonly ids = new Map<string, number>();
  constructor(private readonly maxSize = 10_000, private readonly ttlMs = 60 * 60 * 1000, private readonly now = Date.now) {}
  async has(id: string): Promise<boolean> { this.evict(); return this.ids.has(id); }
  async add(id: string): Promise<void> { this.evict(); this.ids.set(id, this.now()); this.evict(); }
  async clear(): Promise<void> { this.ids.clear(); }
  private evict(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, timestamp] of this.ids) if (timestamp < cutoff) this.ids.delete(id);
    while (this.ids.size > this.maxSize) this.ids.delete(this.ids.keys().next().value as string);
  }
}

export default CursorStore;
