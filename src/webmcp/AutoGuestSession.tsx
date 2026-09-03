import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface LocationState {
  from?: { pathname: string };
}

/** Hackathon-demo-only: silently starts the shared guest session the instant
 * the page loads, so nobody — a judge clicking around, or an agent calling a
 * tool in the first second — ever sees a login screen. Deliberately not part
 * of the real product, where per-account privacy should stay an explicit
 * choice; this only ships on the hackathon deployment of this repo.
 *
 * RequireAuth's redirect to /login (with `state: {from}`) and this effect
 * both react to the same "not authenticated yet" moment, and RequireAuth's
 * fires first — so by the time the guest POST resolves, the page has already
 * moved to /login. A ref (not the `location` the effect closed over, which
 * is frozen at the pre-redirect render) tracks where we actually ended up,
 * so the success callback can send the page back where it was headed,
 * exactly like clicking "Continue as guest" manually would. */
export function AutoGuestSession() {
  const { isAuthenticated, isLoading, loginGuest } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    loginGuest.mutate(undefined, {
      onSuccess: () => {
        const current = locationRef.current;
        if (current.pathname !== '/login') return;
        const from = (current.state as LocationState)?.from?.pathname || '/list';
        navigate(from, { replace: true });
      },
    });
    // Fires once per (isLoading, isAuthenticated) transition, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated]);

  return null;
}
