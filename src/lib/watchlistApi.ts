import type { WatchlistStateDTO, CustomListDTO, Bucket, AddWatchlistItemBody } from "../../shared/types/watchlist";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Every path here carries a segment after /api/watchlist — the server is one
// catch-all function, and a catch-all never matches the bare parent path (see
// api/watchlist/[...path].ts). Bare /api/watchlist 404s in Vercel's router.
export function fetchWatchlistState(): Promise<WatchlistStateDTO> {
  return req("/api/watchlist/state");
}

export function addWatchlistItem(body: AddWatchlistItemBody) {
  return req("/api/watchlist/items", { method: "POST", body: JSON.stringify(body) });
}

export function moveWatchlistItem(dbId: number, bucket: Bucket, listId?: number | null) {
  return req(`/api/watchlist/items/${dbId}`, { method: "PATCH", body: JSON.stringify({ bucket, listId }) });
}

export function removeWatchlistItem(dbId: number) {
  return req(`/api/watchlist/items/${dbId}`, { method: "DELETE" });
}

export function reorderBucket(bucket: Bucket, listId: number | null, orderedIds: number[]) {
  return req("/api/watchlist/reorder", { method: "POST", body: JSON.stringify({ bucket, listId, orderedIds }) });
}

export function fetchCustomLists(): Promise<CustomListDTO[]> {
  return req("/api/watchlist/lists");
}

export function createCustomList(name: string): Promise<CustomListDTO> {
  return req("/api/watchlist/lists", { method: "POST", body: JSON.stringify({ name }) });
}

export function renameCustomList(id: number, name: string): Promise<CustomListDTO> {
  return req(`/api/watchlist/lists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteCustomList(id: number) {
  return req(`/api/watchlist/lists/${id}`, { method: "DELETE" });
}

/**
 * Records where you are in a series, or forgets the show entirely.
 *
 * `season: null` clears rather than writing a zero — "not started" is the
 * absence of a pointer, so there is no value to set it to.
 */
export function setTitleProgress(
  tmdbId: number,
  season: number | null,
  episode?: number,
) {
  return req("/api/watchlist/progress", {
    method: "POST",
    body: JSON.stringify({ tmdbId, mediaType: "tv", season, episode }),
  });
}
