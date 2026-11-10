import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProvidersBatch } from './providers';
vi.mock('@/lib/http', () => ({ fetchJson: vi.fn() }));
import { fetchJson } from '@/lib/http';
beforeEach(() => vi.mocked(fetchJson).mockReset());

describe('provider batch compatibility', () => {
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
});
