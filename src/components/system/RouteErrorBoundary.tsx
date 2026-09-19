import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { isChunkLoadError, reloadForStaleChunk } from '@/lib/chunkError';
import { RouteFallback } from './RouteFallback';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** True between "we caught a chunk error" and "the reload was refused". While
   *  it holds we render the loading state, never the error copy — a reload is
   *  already on its way and flashing a failure message on the way out is just
   *  noise the user can't act on. */
  recovering: boolean;
}

/**
 * The last line of defence for a route render.
 *
 * Without this, any throw below the Suspense boundary unmounts the entire React
 * root and leaves an empty `#root` — indistinguishable, to the user, from a page
 * that "just didn't load". Two distinct failures land here:
 *
 *  1. A stale chunk after a deploy (see lib/chunkError.ts) — recoverable, so we
 *     reload once and say nothing.
 *  2. A genuine render bug — not recoverable, so we show something honest with a
 *     way out instead of a blank screen.
 */
class RouteErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null, recovering: false };

  // Pure, as React requires — it only classifies. The reload itself is a side
  // effect and belongs in componentDidCatch below.
  static getDerivedStateFromError(error: Error): State {
    return { error, recovering: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // Refused means the cooldown is active: a reload already failed to fix
      // this, so stop pretending and let render() explain.
      if (reloadForStaleChunk()) return;
      this.setState({ recovering: false });
    }
    // Kept as console.error rather than a toast: this fires during render, when
    // the tree is already torn down and no toast host is guaranteed alive.
    console.error('[spotlight] route render failed', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null, recovering: false });

  render() {
    const { error, recovering } = this.state;
    if (!error) return this.props.children;

    // A reload is in flight; show the ordinary loading state, because that is
    // honestly what's happening.
    if (recovering) return <RouteFallback />;

    const stale = isChunkLoadError(error);

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {stale ? 'This page is out of date' : 'Something broke on this page'}
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {stale
            ? 'A new version of Spotlight shipped while this tab was open. Reloading should pick it up.'
            : 'The rest of the app still works - you can head back and try again.'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground transition-all hover:brightness-110"
          >
            <RefreshCw size={14} /> Reload
          </button>
          <button
            type="button"
            onClick={this.reset}
            className="rounded-full border border-border px-5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}

/**
 * Keyed on pathname so navigating away from a broken route clears the error —
 * otherwise one bad page would poison every subsequent navigation, since the
 * boundary itself never unmounts.
 */
export function RouteErrorBoundary({ children }: Props) {
  const { pathname } = useLocation();
  return <RouteErrorBoundaryInner key={pathname}>{children}</RouteErrorBoundaryInner>;
}
