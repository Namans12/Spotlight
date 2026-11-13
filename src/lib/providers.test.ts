import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProvidersBatch, providerStaleTime } from './providers';
vi.mock('@/lib/http', () => ({ fetchJson: vi.fn() }));
import { fetchJson } from '@/lib/http';
beforeEach(() => { vi.mocked(fetchJson).mockReset(); });

describe('provider batch compatibility', () => {
  it('makes incomplete data stale sooner than complete regional lookups', () => {
    const batch = { providers: {}, runtimes: {}, genres: {} };
    expect(providerStaleTime({ state: { data: batch } })).toBe(6 * 60 * 60_000);
    expect(providerStaleTime({ state: { data: { ...batch, hadFailures: true } } })).toBe(60_000);
  });
  it('leaves offer type unknown for a legacy cached provider response', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ providers: { 'movie:1': ['Netflix'] }, runtimes: {}, genres: {} });
    const result = await fetchProvidersBatch([{ id: 1, mediaType: 'movie' }]);
    expect(result.providers['movie:1']).toEqual(['Netflix']);
    expect(result.availability?.['movie:1']).toBeUndefined();
  });
  it('retains structured offers returned by the current API', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ providers: {}, availability: { 'movie:1': [{ provider: 'Netflix', type: 'rent' }] }, runtimes: {}, genres: {} });
    const result = await fetchProvidersBatch([{ id: 1, mediaType: 'movie' }]);
    expect(result.availability?.['movie:1']).toEqual([{ provider: 'Netflix', type: 'rent' }]);
  });
  it('preserves partial lookup failure without discarding successful offers', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ providers: {}, availability: { 'movie:1': [{ provider: 'Netflix', type: 'subscription' }] }, runtimes: {}, genres: {}, hadFailures: true });
    const result = await fetchProvidersBatch([{ id: 1, mediaType: 'movie' }, { id: 2, mediaType: 'movie' }]);
    expect(result.hadFailures).toBe(true);
    expect(result.availability?.['movie:1']).toHaveLength(1);
    expect(result.availability?.['movie:2']).toBeUndefined();
  });
  it('fetches every unique title in server-sized chunks and merges the results', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ providers: { 'movie:1': ['Netflix'] }, runtimes: { 'movie:1': 90 }, genres: {} })
      .mockResolvedValueOnce({ providers: { 'movie:101': ['Prime Video'] }, availability: { 'movie:101': [{ provider: 'Prime Video', type: 'rent' }] }, runtimes: {}, genres: {} });
    const items = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, mediaType: 'movie' }));
    const result = await fetchProvidersBatch([...items, items[0]]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(vi.mocked(fetchJson).mock.calls[0][0]).split('ids=')[1].split(',')).toHaveLength(100);
    expect(decodeURIComponent(vi.mocked(fetchJson).mock.calls[1][0])).toContain('ids=movie:101');
    expect(result.providers['movie:1']).toEqual(['Netflix']);
    expect(result.availability?.['movie:101']).toEqual([{ provider: 'Prime Video', type: 'rent' }]);
  });
  it('retains successful chunks and reports failures without inventing missing offers', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ providers: { 'movie:1': ['Netflix'] }, runtimes: {}, genres: {} })
      .mockRejectedValueOnce(new Error('network'));
    const result = await fetchProvidersBatch(Array.from({ length: 101 }, (_, index) => ({ id: index + 1, mediaType: 'movie' })));
    expect(result.hadFailures).toBe(true);
    expect(result.providers['movie:1']).toEqual(['Netflix']);
    expect(result.availability?.['movie:101']).toBeUndefined();
  });
  it('rejects when every request fails', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('network'));
    await expect(fetchProvidersBatch([{ id: 1, mediaType: 'movie' }])).rejects.toThrow('network');
  });
});
