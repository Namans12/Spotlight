export interface StreamCounter {
  /** A release function if the key has a free slot, else null. Calling the function more than once frees the slot only once. */
  tryAcquire(key: string): (() => void) | null;
  /** Number of keys with an open stream, for tests. */
  size(): number;
}

/** At most `max` open streams per key (the client address). One chat can hold
 *  a connection for up to 90 s, and the per-minute rate limiter alone would
 *  still let one client hold dozens open at once. Entries are deleted when
 *  they reach zero, so memory is bounded by the streams open right now. */
export function createStreamCounter(max: number): StreamCounter {
  const open = new Map<string, number>();
  return {
    tryAcquire(key) {
      const n = open.get(key) ?? 0;
      if (n >= max) return null;
      open.set(key, n + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (open.get(key) ?? 1) - 1;
        if (left <= 0) open.delete(key); else open.set(key, left);
      };
    },
    size: () => open.size,
  };
}
