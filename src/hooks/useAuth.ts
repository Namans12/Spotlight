import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  /** Opt-in for "a title on your watchlist just landed" email. Off unless the
   * account turned it on — nobody is enrolled by default, because this sends
   * mail to a real address. */
  notifyWatchlistDrops: boolean;
}

interface SessionResponse {
  authenticated: boolean;
  user: SessionUser | null;
}

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch('/api/auth');
  if (!res.ok) return { authenticated: false, user: null };
  return res.json();
}

export function useAuth() {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: fetchSession,
    staleTime: 60_000,
    retry: false,
  });

  /** Turns watchlist-drop email on or off for the signed-in account.
   * Optimistic: a switch that waits for a round trip before moving reads as
   * broken, and the only failure mode is that it flips back with a message. */
  const setNotifyWatchlistDrops = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch('/api/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyWatchlistDrops: enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not save that setting');
      }
      return (await res.json()) as { user: SessionUser };
    },
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: ['auth', 'session'] });
      const previous = queryClient.getQueryData<SessionResponse>(['auth', 'session']);
      if (previous?.user) {
        queryClient.setQueryData<SessionResponse>(['auth', 'session'], {
          ...previous,
          user: { ...previous.user, notifyWatchlistDrops: enabled },
        });
      }
      return { previous };
    },
    onError: (_err, _enabled, context) => {
      if (context?.previous) queryClient.setQueryData(['auth', 'session'], context.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData<SessionResponse>(['auth', 'session'], {
        authenticated: true,
        user: data.user,
      });
    },
  });

  /** Takes the ID token Google Identity Services hands back after sign-in —
   * a JWT the backend verifies against Google's public keys, not a password. */
  const login = useMutation({
    mutationFn: async (idToken: string) => {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Sign-in failed');
      }
      return res.json();
    },
    onSuccess: (data: { user: SessionUser }) => {
      // Set directly rather than invalidate+refetch — mutateAsync callers
      // (e.g. the login page's navigate()) must see the new auth state
      // immediately, not after a second network round-trip.
      queryClient.setQueryData(['auth', 'session'], { authenticated: true, user: data.user });
    },
  });

  /** Same session mechanism as Google sign-in, minus a real identity — lands
   * on one fixed shared demo account (see upsertGuestUser). Lets someone
   * (or a WebMCP tool call, see src/webmcp/registerTools.ts) skip Google
   * entirely to try the watchlist features. */
  const loginGuest = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not start a guest session');
      }
      return res.json();
    },
    onSuccess: (data: { user: SessionUser }) => {
      queryClient.setQueryData(['auth', 'session'], { authenticated: true, user: data.user });
    },
  });

  const logout = useMutation({
    mutationFn: async () => {
      await fetch('/api/auth', { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'session'], { authenticated: false, user: null });
    },
  });

  return {
    isAuthenticated: sessionQuery.data?.authenticated ?? false,
    isLoading: sessionQuery.isLoading,
    user: sessionQuery.data?.user ?? null,
    login,
    loginGuest,
    logout,
    setNotifyWatchlistDrops,
  };
}
