// A small in-process TTL cache. Drafted campaigns go here so that opening the
// same brief again (a refresh, a second tab, a judge clicking back and forth)
// does not spend LLM budget. It is per process and forgotten on restart,
// which is fine: a miss only costs one draft.

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  size(): number;
}

export interface TtlCacheOptions {
  ttlMs: number;
  /** Upper bound on entries; the oldest is evicted past it. */
  max: number;
  now?: () => number;
}

/** Entries expire `ttlMs` after they were set (reads do not extend them). Past
 *  `max`, expired entries are swept first and then the oldest live one is
 *  dropped. Map iteration order is insertion order, and re-setting a key
 *  re-inserts it, so the first key is always the oldest. */
export function createTtlCache<V>(opts: TtlCacheOptions): TtlCache<V> {
  const now = opts.now ?? Date.now;
  const entries = new Map<string, { value: V; at: number }>();
  const expired = (at: number, t: number) => t - at >= opts.ttlMs;

  return {
    get(key) {
      const e = entries.get(key);
      if (!e) return undefined;
      if (expired(e.at, now())) { entries.delete(key); return undefined; }
      return e.value;
    },
    set(key, value) {
      const t = now();
      entries.delete(key);
      entries.set(key, { value, at: t });
      if (entries.size > opts.max) {
        for (const [k, e] of entries) if (expired(e.at, t)) entries.delete(k);
      }
      while (entries.size > opts.max) entries.delete(entries.keys().next().value as string);
    },
    size: () => entries.size,
  };
}
