import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
const mocks = vi.hoisted(() => ({ guestEnabled: false, user: { id: 5, email: 'guest@spotlight.demo' } }));
vi.mock('../lib/auth.js', () => ({ getSessionUserId: () => 5, clearSessionCookie: () => 'expired', createSessionCookie: vi.fn(), verifyGoogleIdToken: vi.fn() }));
vi.mock('../lib/db.js', () => ({ getDb: vi.fn() }));
vi.mock('../lib/usersDb.js', () => ({ getUserById: async () => mocks.user, guestSessionsEnabled: () => mocks.guestEnabled, upsertGuestUser: vi.fn(), upsertUserFromGoogle: vi.fn(), setNotifyWatchlistDrops: vi.fn() }));
import handler from '../api/auth';
describe('account transition from demo mode', () => {
 it('clears an existing shared demo session when guest mode is disabled', async () => {
  mocks.user = { id: 5, email: 'guest@spotlight.demo' }; mocks.guestEnabled = false;
  const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
  await handler({ method: 'GET' } as IncomingMessage, res as unknown as ServerResponse);
  expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', 'expired');
  expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ authenticated: false, user: null });
 });
 it('keeps a personal account signed in when guest mode is disabled', async () => {
  mocks.user = { id: 5, email: 'personal@example.test' }; mocks.guestEnabled = false;
  const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
  await handler({ method: 'GET' } as IncomingMessage, res as unknown as ServerResponse);
  expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ authenticated: true, user: mocks.user });
  expect(res.setHeader).not.toHaveBeenCalledWith('Set-Cookie', 'expired');
 });
});
