import { expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

vi.mock('../../lib/tmdbProxy.js', () => ({ tmdbTrending: vi.fn().mockRejectedValue(new Error('https://example.invalid/?api_key=secret-value')) }));
vi.mock('../../lib/rateLimit.js', () => ({ isRateLimited: () => false }));
import handler from './[...path]';

it('does not log or return upstream exception details', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
  try {
    await handler({ url: '/api/tmdb/trending' } as IncomingMessage, response as unknown as ServerResponse);
    expect(response.statusCode).toBe(500);
    expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'could not reach TMDB' }));
    expect(log).toHaveBeenCalledWith('[tmdb] proxy request failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-value');
  } finally { log.mockRestore(); }
});
