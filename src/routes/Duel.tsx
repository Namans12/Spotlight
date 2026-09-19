import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, RotateCcw, Sparkles, Swords } from 'lucide-react';
import { getTrending, getPopularMovies, getPopularTV, getYouMayAlsoLike, type MediaType } from '@/lib/tmdb';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useGenres, useRuntimes } from '@/hooks/useProviders';
import { buildPool, type PoolSource } from '@/lib/duelPool';
import {
  nextPair,
  recordPick,
  duelWinner,
  explainWinner,
  DUEL_ROUNDS,
  type DuelCandidate,
  type DuelPick,
  type Weights,
} from '@/lib/duel';
import { tmdbPosterFluid } from '@/lib/tmdbImage';
import { useDocumentMeta, siteUrl } from '@/hooks/useDocumentMeta';
import { staticRouteMeta } from '../../shared/seo';

/** Big enough that five rounds never run it dry, small enough that one
 *  providers batch covers it. */
const POOL_SIZE = 20;

/**
 * "I don't know what to watch."
 *
 * Two posters, pick one, five times. No questions, no genre checkboxes, no
 * curated list — the brief for this was explicitly that a fixed question tree
 * lands everyone on the same film. The candidates come from what is trending,
 * what this reader saved and never watched, and what the recommendation engine
 * makes of their taste; the picks reweight the pool as they go.
 */
export default function Duel() {
  const wl = useWatchlistContext();
  const [weights, setWeights] = useState<Weights>({});
  const [picks, setPicks] = useState<DuelPick[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  // Bumped by "Again", which is what re-runs the pool memo below. Without it
  // a replay would deal the same twenty posters from the same cached queries.
  const [run, setRun] = useState(0);

  useDocumentMeta(staticRouteMeta('/duel', siteUrl()));

  const trending = useQuery({ queryKey: ['tmdb', 'trending'], queryFn: getTrending, staleTime: 60 * 60_000 });
  const films = useQuery({ queryKey: ['tmdb', 'popular-movies'], queryFn: getPopularMovies, staleTime: 60 * 60_000 });
  const shows = useQuery({ queryKey: ['tmdb', 'popular-tv'], queryFn: getPopularTV, staleTime: 60 * 60_000 });

  // Seeded from the most recently saved title, which is the freshest statement
  // of taste this app has. Nothing to seed from is fine — the pool just draws
  // from the other three sources.
  const seed = [...wl.watchlist, ...wl.watchLater].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))[0];
  const recommended = useQuery({
    queryKey: ['tmdb', 'you-may-also-like', seed?.mediaType, seed?.id],
    queryFn: () => getYouMayAlsoLike(seed.mediaType as MediaType, seed.id),
    enabled: Boolean(seed),
    staleTime: 60 * 60_000,
  });

  // Every source is in, or is never coming. Recommendations are only waited
  // for when there is something to seed them from.
  const ready = !trending.isLoading && !films.isLoading && !shows.isLoading && (!seed || !recommended.isLoading);

  /**
   * The pool is dealt ONCE per run, into state.
   *
   * It was a useMemo, which is wrong for this in a way that only shows up at
   * runtime: buildPool shuffles, so the memo is not a pure function of its
   * inputs, and every time one of those inputs changed identity the reader got
   * a different twenty posters. That happened on nearly every render, which
   * meant a new providers batch each time (eight TMDB fan-outs for one duel)
   * and genres that never resolved for the pool actually on screen — the
   * scoring was running on media type and decade alone.
   *
   * A hand of cards is dealt, not derived.
   */
  const [rawPool, setRawPool] = useState<DuelCandidate[] | null>(null);

  useEffect(() => {
    if (rawPool !== null || !ready) return;
    const sources: PoolSource[] = [
      // Saved and never watched leads deliberately: the reader has already
      // said they want to see these, so the only thing standing between them
      // and a decision is the decision.
      { name: 'saved', items: [...wl.watchlist, ...wl.watchLater] },
      { name: 'recommended', items: recommended.data ?? [] },
      { name: 'trending', items: trending.data ?? [] },
      { name: 'films', items: films.data ?? [] },
      { name: 'shows', items: shows.data ?? [] },
    ];
    setRawPool(buildPool(sources, { watchedKeys: wl.watchedKeys, limit: POOL_SIZE }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, rawPool, run]);

  const loading = !ready || rawPool === null;

  // Genres and runtime for the whole pool in one request — the same batch the
  // grids already use, which carries both for free (lib/tmdbProxy.ts). These
  // are what the scoring is actually about, so a pool without them still
  // works but has only language, media type and decade to reason over.
  const genresFor = useGenres(rawPool ?? []);
  const runtimeFor = useRuntimes(rawPool ?? []);

  const pool: DuelCandidate[] = useMemo(
    () =>
      (rawPool ?? []).map((candidate) => ({
        ...candidate,
        genres: genresFor(candidate.mediaType, candidate.id),
        runtime: runtimeFor(candidate.mediaType, candidate.id),
      })),
    [rawPool, genresFor, runtimeFor],
  );

  const pair = picks.length < DUEL_ROUNDS ? nextPair(pool, weights, seen) : null;
  const finished = picks.length > 0 && !pair;
  const winner = finished ? duelWinner(picks, weights) : null;

  function choose(winnerCandidate: DuelCandidate, loserCandidate: DuelCandidate) {
    const pick = { winner: winnerCandidate, loser: loserCandidate };
    setWeights((current) => recordPick(current, pick));
    setPicks((current) => [...current, pick]);
    setSeen((current) => {
      const next = new Set(current);
      next.add(`${winnerCandidate.mediaType}:${winnerCandidate.id}`);
      next.add(`${loserCandidate.mediaType}:${loserCandidate.id}`);
      return next;
    });
  }

  function restart() {
    setWeights({});
    setPicks([]);
    setSeen(new Set());
    setRawPool(null); // Deal a fresh hand.
    setRun((n) => n + 1);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-accent">
          <Swords size={14} /> Pick one
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground">Can&rsquo;t decide?</h1>
        <p className="text-sm text-muted-foreground">
          Two posters, five times. No right answer — just pick whichever you&rsquo;d rather watch tonight.
        </p>
      </header>

      {pair ? (
        <>
          <div className="flex items-center gap-3">
            <div className="h-1 flex-1 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${(picks.length / DUEL_ROUNDS) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {picks.length + 1} of {DUEL_ROUNDS}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <PosterChoice candidate={pair[0]} onChoose={() => choose(pair[0], pair[1])} />
            <PosterChoice candidate={pair[1]} onChoose={() => choose(pair[1], pair[0])} />
          </div>
        </>
      ) : winner ? (
        <Result winner={winner} weights={weights} onAgain={restart} onAdd={() => wl.addToWatchlist(winner)} />
      ) : (
        <NothingToOffer signedIn={Boolean(seed)} />
      )}
    </div>
  );
}

function PosterChoice({ candidate, onChoose }: { candidate: DuelCandidate; onChoose: () => void }) {
  const poster = tmdbPosterFluid(
    candidate.posterPath ? `https://image.tmdb.org/t/p/w500${candidate.posterPath}` : null,
    [342, 500],
  );

  return (
    <button
      type="button"
      onClick={onChoose}
      className="group text-left rounded-2xl overflow-hidden bg-secondary ring-1 ring-border hover:ring-accent focus-visible:ring-accent focus-visible:ring-2 active:scale-[0.98] transition-all"
    >
      <div className="relative aspect-[2/3] bg-secondary">
        {poster && (
          <img
            src={poster.src}
            srcSet={poster.srcSet}
            sizes="(min-width: 640px) 320px, 45vw"
            alt=""
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-foreground leading-tight line-clamp-2">{candidate.title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {candidate.releaseDate?.slice(0, 4)} · {candidate.mediaType === 'tv' ? 'Series' : 'Film'}
        </p>
      </div>
    </button>
  );
}

function Result({
  winner,
  weights,
  onAgain,
  onAdd,
}: {
  winner: DuelCandidate;
  weights: Weights;
  onAgain: () => void;
  onAdd: () => void;
}) {
  const poster = tmdbPosterFluid(
    winner.posterPath ? `https://image.tmdb.org/t/p/w500${winner.posterPath}` : null,
    [342, 500],
  );
  const why = explainWinner(winner, weights);

  return (
    <div className="rounded-2xl bg-card p-4 sm:p-5">
      <div className="flex gap-4">
        <div className="w-28 sm:w-36 shrink-0 rounded-xl overflow-hidden bg-secondary">
          {poster && <img src={poster.src} srcSet={poster.srcSet} sizes="144px" alt="" className="w-full h-auto" />}
        </div>
        <div className="min-w-0 flex flex-col">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
            <Sparkles size={13} /> Watch this
          </p>
          <h2 className="mt-1 font-display text-xl sm:text-2xl font-bold text-foreground leading-tight">
            {winner.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {winner.releaseDate?.slice(0, 4)} · {winner.mediaType === 'tv' ? 'Series' : 'Film'}
          </p>
          {/* Only when there is something true to say. A made-up reason is
              worse than none — it is the moment someone stops believing the
              rest of the page. */}
          {why && <p className="mt-2 text-sm text-foreground/90 leading-relaxed">{why}</p>}

          <div className="mt-auto pt-3 flex flex-wrap gap-2">
            <Link
              to={`/title/${winner.mediaType}/${winner.id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
            >
              Where to watch
            </Link>
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-card-hover active:scale-95 transition-all"
            >
              <Plus size={12} strokeWidth={2.5} /> Watchlist
            </button>
            <button
              type="button"
              onClick={onAgain}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-card-hover active:scale-95 transition-all"
            >
              <RotateCcw size={12} /> Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reached when there are not two things left to offer — a cold start where
 *  TMDB is unreachable, or a reader who has marked almost everything seen. */
function NothingToOffer({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="rounded-xl bg-card p-6 space-y-3">
      <p className="text-sm text-foreground">Not enough to choose between right now.</p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {signedIn
          ? 'Almost everything on offer is already marked seen. Browse a little and this fills back up.'
          : 'This works best once there is something to go on — save a few titles and it gets sharper.'}
      </p>
      <Link
        to="/browse"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
      >
        Browse titles
      </Link>
    </div>
  );
}
