import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { IncomingMessage } from 'http';
import { isRateLimited, __resetRateLimitForTests, __rateLimitInternals } from './rateLimit';

const { MAX_REQUESTS_PER_WINDOW, MAX_TRACKED_CLIENTS, WINDOW_MS, size } = __rateLimitInternals;

/** Minimal shape isRateLimited actually reads. */
function reqFrom(ip: string): IncomingMessage {
  return { headers: { 'x-forwarded-for': ip }, socket: {} } as unknown as IncomingMessage;
}

beforeEach(() => {
  __resetRateLimitForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  __resetRateLimitForTests();
});

describe('isRateLimited', () => {
  it('allows up to the cap and blocks past it, per client', () => {
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i += 1) {
      expect(isRateLimited(reqFrom('1.1.1.1'))).toBe(false);
    }
    expect(isRateLimited(reqFrom('1.1.1.1'))).toBe(true);
    // A different client is unaffected by the first one's spending.
    expect(isRateLimited(reqFrom('2.2.2.2'))).toBe(false);
  });

  it('lets a blocked client through again once its window lapses', () => {
    for (let i = 0; i <= MAX_REQUESTS_PER_WINDOW; i += 1) isRateLimited(reqFrom('1.1.1.1'));
    expect(isRateLimited(reqFrom('1.1.1.1'))).toBe(true);

    vi.advanceTimersByTime(WINDOW_MS + 1);
    expect(isRateLimited(reqFrom('1.1.1.1'))).toBe(false);
  });

  it('falls back to the socket address when there is no forwarded header', () => {
    const req = { headers: {}, socket: { remoteAddress: '3.3.3.3' } } as unknown as IncomingMessage;
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i += 1) expect(isRateLimited(req)).toBe(false);
    expect(isRateLimited(req)).toBe(true);
  });

  // The leak this file exists to prevent: X-Forwarded-For is caller-supplied,
  // so without a bound, one client can add a Map entry per request forever.
  it('does not grow without bound when every request invents a new client key', () => {
    for (let i = 0; i < MAX_TRACKED_CLIENTS + 500; i += 1) {
      isRateLimited(reqFrom(`10.0.${(i >> 8) & 255}.${i & 255}`));
    }
    expect(size()).toBeLessThanOrEqual(MAX_TRACKED_CLIENTS);
  });

  it('fails closed rather than open once the table is full of unique keys', () => {
    for (let i = 0; i < MAX_TRACKED_CLIENTS; i += 1) {
      isRateLimited(reqFrom(`10.1.${(i >> 8) & 255}.${i & 255}`));
    }
    // A brand-new key with nowhere to be tracked is treated as limited, so
    // "flood the table, then attack from a fresh IP" gains nothing.
    expect(isRateLimited(reqFrom('203.0.113.9'))).toBe(true);
  });

  it('reclaims memory once lapsed windows are swept', () => {
    for (let i = 0; i < 2_000; i += 1) {
      isRateLimited(reqFrom(`10.2.${(i >> 8) & 255}.${i & 255}`));
    }
    expect(size()).toBe(2_000);

    // Every one of those windows has lapsed; the next call sweeps them.
    vi.advanceTimersByTime(WINDOW_MS + 1);
    isRateLimited(reqFrom('4.4.4.4'));
    expect(size()).toBe(1);
  });

  it('never evicts an active client to make room', () => {
    // Establish a client, then flood with unique keys within the same window.
    expect(isRateLimited(reqFrom('5.5.5.5'))).toBe(false);
    for (let i = 0; i < MAX_TRACKED_CLIENTS + 100; i += 1) {
      isRateLimited(reqFrom(`10.3.${(i >> 8) & 255}.${i & 255}`));
    }
    // The established client keeps counting from where it was, rather than
    // being dropped and silently handed a fresh allowance.
    for (let i = 1; i < MAX_REQUESTS_PER_WINDOW; i += 1) {
      expect(isRateLimited(reqFrom('5.5.5.5'))).toBe(false);
    }
    expect(isRateLimited(reqFrom('5.5.5.5'))).toBe(true);
  });
});
