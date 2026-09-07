import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { DEMO_GUEST_ENABLED } from '@/webmcp/demoGuest';
import { Sparkles, Loader2 } from 'lucide-react';

interface LocationState {
  from?: { pathname: string };
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export default function Login() {
  const { login, loginGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [scriptReady, setScriptReady] = useState(false);

  const continueAsGuest = async () => {
    setError('');
    try {
      await loginGuest.mutateAsync();
      const from = (location.state as LocationState)?.from?.pathname || '/list';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a guest session');
    }
  };

  useEffect(() => {
    if (!CLIENT_ID) {
      setError('Sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).');
      return;
    }

    // The GIS script tag in index.html loads with async/defer, so it may not
    // be ready the instant this route mounts — poll rather than assume.
    let attempts = 0;
    const poll = setInterval(() => {
      attempts += 1;
      if (window.google?.accounts?.id) {
        clearInterval(poll);
        setScriptReady(true);
      } else if (attempts > 50) {
        clearInterval(poll);
        setError('Could not reach Google Sign-In — check your connection and reload.');
      }
    }, 100);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (!scriptReady || !buttonRef.current || !CLIENT_ID) return;

    window.google!.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (response) => {
        setError('');
        try {
          await login.mutateAsync(response.credential);
          const from = (location.state as LocationState)?.from?.pathname || '/list';
          navigate(from, { replace: true });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Sign-in failed');
        }
      },
    });

    window.google!.accounts.id.renderButton(buttonRef.current, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'left',
    });
    // location/navigate change identity on every render in some router
    // versions; the button only needs to be (re-)rendered once the script is
    // ready, so this deliberately excludes them from the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady]);

  return (
    <div className="flex flex-col items-center justify-center py-20 max-w-sm mx-auto text-center">
      <Sparkles size={32} className="mb-3 text-accent opacity-80" />
      <h2 className="font-display text-lg font-bold text-foreground">Sign in to Spotlight</h2>
      <p className="text-xs text-muted-foreground mt-1 mb-6">Your watchlist is private to your account and follows you to any device.</p>

      {!scriptReady && !error && <Loader2 size={20} className="animate-spin text-accent mb-4" />}
      <div ref={buttonRef} />

      {/* Hidden unless this build is the demo deployment — the server refuses
          guest sign-in without DEMO_GUEST=1, so showing the button elsewhere
          would just offer an action that always fails. */}
      {DEMO_GUEST_ENABLED && (
        <button
          type="button"
          onClick={continueAsGuest}
          disabled={loginGuest.isPending}
          className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground disabled:opacity-60"
        >
          {loginGuest.isPending && <Loader2 size={12} className="animate-spin" />}
          Continue as guest (shared demo account, no sign-in)
        </button>
      )}

      {error && <p className="text-xs text-danger font-medium mt-4">{error}</p>}
    </div>
  );
}
