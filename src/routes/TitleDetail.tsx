import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTitleDetail, titleDetailToMovie } from '@/lib/tmdbDetail';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { ActionButton } from '@/components/watchlist/ActionButton';
import { PosterRow } from '@/components/release/PosterRow';
import { useRelations } from '@/hooks/useRelations';
import { hasAnyRelations, hasChain } from '@/lib/relations';
import { titleDetailMeta } from '../../shared/seo';
import { useDocumentMeta, siteUrl } from '@/hooks/useDocumentMeta';
import { getYouMayAlsoLike, type MediaType } from '@/lib/tmdb';
import { RatingBadges } from '@/components/release/RatingBadges';
import { useRating } from '@/hooks/useRatings';
import { hasAnyScore } from '@/lib/ratings';
import { tmdbBackdrop, tmdbPoster } from '@/lib/tmdbImage';
import {
  ArrowLeft,
  Star,
  Clock,
  ExternalLink,
  Plus,
  Loader2,
  Sparkles,
  ListOrdered,
  Popcorn,
  ChevronRight,
  ChevronDown,
  Layers,
} from 'lucide-react';

export default function TitleDetail() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // 'default' means this entry has no history behind it in this tab — a
  // fresh load, a deep link, or a reload — so there is nothing to go back to.
  // Every other value means the user actually navigated here from within the
  // app (Calendar, Search, Home, ...), and should land back on exactly that,
  // not always on Home regardless of where they came from.
  const goBack = () => (location.key === 'default' ? navigate('/') : navigate(-1));
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(id);
  const { isAuthenticated } = useAuth();
  const wl = useWatchlistContext();
  // Visible by default — every other surface (Home, Browse, Search) shows its
  // recommendation rows without an extra click, so hiding this one behind a
  // toggle read as broken rather than collapsed. The toggle still exists for
  // anyone who'd rather close it.
  const [showRecommendations, setShowRecommendations] = useState(true);

  // Depth 1 is all this page needs: it only asks "is there anything to go and
  // look at". The connections view does the real walk at MAX_DEPTH.
  const relationsQuery = useRelations(mediaType, tmdbId, 1);
  const relations = relationsQuery.data;
  const showConnections = hasAnyRelations(relations);
  const isChain = hasChain(relations);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tmdb', 'detail', mediaType, tmdbId],
    queryFn: () => fetchTitleDetail(mediaType, tmdbId),
    enabled: Number.isFinite(tmdbId),
    staleTime: 60 * 60_000,
  });

  const recommendationsQuery = useQuery({
    queryKey: ['tmdb', 'you-may-also-like', mediaType, tmdbId],
    queryFn: () => getYouMayAlsoLike(mediaType as MediaType, tmdbId),
    enabled: Number.isFinite(tmdbId),
    staleTime: 60 * 60_000,
  });
  const recommendations = recommendationsQuery.data ?? [];
  const ratingQuery = useRating(mediaType, tmdbId);

  // Above the loading guard: hooks cannot be conditional. Null while the
  // detail loads, which leaves any prerendered tags untouched.
  useDocumentMeta(
    data
      ? titleDetailMeta(
          {
            title: data.title,
            mediaType,
            tmdbId,
            releaseDate: data.releaseDate || null,
            overview: data.overview,
            posterUrl: data.posterUrl,
          },
          siteUrl(),
        )
      : null,
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={28} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} className="shrink-0" /> Back
        </button>
        <p className="text-sm text-muted-foreground">Could not load this title.</p>
      </div>
    );
  }

  const year = data.releaseDate?.slice(0, 4);
  const movie = titleDetailToMovie(data);
  // Full-bleed but content-column width, not viewport width — 700 lands the
  // 1x bucket on w780 rather than the previous flat w1280.
  const backdrop = tmdbBackdrop(data.backdropUrl, 700);
  const poster = tmdbPoster(data.posterUrl, 112); // sm:w-28 = 112px

  return (
    <div className="space-y-5 -mt-6">
      <div className="relative -mx-4 sm:-mx-6 rounded-b-2xl overflow-hidden">
        {backdrop ? (
          <img
            src={backdrop.src}
            srcSet={backdrop.srcSet}
            alt=""
            decoding="async"
            className="w-full h-52 sm:h-72 object-cover"
          />
        ) : (
          <div className="w-full h-40 bg-secondary" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="absolute top-4 left-4 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-background/70 text-foreground backdrop-blur-sm hover:bg-background/90 transition-all"
        >
          <ArrowLeft size={16} />
        </button>
      </div>

      <div className="px-1 -mt-16 sm:-mt-20 relative flex gap-4 items-end">
        <div className="w-24 h-36 sm:w-28 sm:h-40 rounded-xl overflow-hidden bg-secondary border-2 border-background shrink-0 shadow-lg">
          {poster && (
            <img
              src={poster.src}
              srcSet={poster.srcSet}
              alt=""
              decoding="async"
              className="w-full h-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 pb-1">
          <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground leading-tight">{data.title}</h1>
          <div className="flex items-center gap-2.5 mt-1.5 text-xs text-muted-foreground flex-wrap">
            {year && <span>{year}</span>}
            <span className="uppercase font-semibold text-accent">{data.mediaType === 'tv' ? 'TV' : 'Film'}</span>
            {/* IMDb/RT when known; the TMDB score is the fallback so the line
                is never empty while the ratings cache is still filling. */}
            {hasAnyScore(ratingQuery.data) ? (
              <RatingBadges rating={ratingQuery.data} size="md" />
            ) : (
              data.rating != null && (
                <span className="inline-flex items-center gap-1 text-gold">
                  <Star size={11} fill="currentColor" /> {data.rating.toFixed(1)}
                </span>
              )
            )}
            {data.mediaType === 'tv' && data.numberOfSeasons && (
              <span className="inline-flex items-center gap-1">
                <Layers size={11} /> {data.numberOfSeasons} {data.numberOfSeasons === 1 ? 'Season' : 'Seasons'}
              </span>
            )}
            {data.runtime && (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> {data.runtime}m
              </span>
            )}
          </div>
        </div>
      </div>

      {data.genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {data.genres.map((g) => (
            <span key={g} className="text-[11px] px-2 py-1 rounded-full bg-secondary text-secondary-foreground font-medium">
              {g}
            </span>
          ))}
        </div>
      )}

      {data.providers.length > 0 && (
        <div className="px-1">
          {/* Not "Streaming on" — resolveProviders' fallback tiers (see
              lib/tmdbProxy.ts) can return purchase-only entries tagged
              "(Buy/Rent)", or a bare "Buy/Rent" when no store name survived
              normalization. "Streaming on Buy/Rent" would be a label that's
              simply false; "Where to watch" is accurate for every tier. */}
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Where to watch</p>
          <p className="text-sm text-accent font-medium">{data.providers.join(', ')}</p>
        </div>
      )}

      {data.overview && <p className="px-1 text-sm text-foreground/90 leading-relaxed">{data.overview}</p>}

      <div className="px-1 flex flex-wrap items-center gap-2">
        {isAuthenticated ? (
          <>
            <ActionButton
              onClick={() => wl.addToWatchlist(movie)}
              icon={<Plus size={12} strokeWidth={2.5} />}
              label="Watchlist"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
              successClassName="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-watched/20 text-watched text-xs font-semibold"
            />
            <ActionButton
              onClick={() => wl.addToWatchLater(movie)}
              icon={<Clock size={12} />}
              label="Watch Later"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-card-hover active:scale-95 transition-all"
              successClassName="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-watched/20 text-watched text-xs font-medium"
            />
          </>
        ) : (
          <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground underline">
            Sign in to add this to your watchlist
          </Link>
        )}
        <a
          href={data.tmdbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground ml-auto"
        >
          View on TMDB <ExternalLink size={11} />
        </a>
      </div>

      {/* Two doors, deliberately unequal. "What does this assume I've seen" is
          a sharper question than "what else might I like", so relations get a
          screen of their own while recommendations stay folded away here. Both
          self-hide when there's nothing behind them. */}
      {(showConnections || recommendations.length > 0) && (
        <div className="px-1 pt-1 flex flex-wrap gap-2">
          {showConnections && (
            <Link
              to={`/title/${mediaType}/${tmdbId}/connections`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground text-xs font-semibold hover:bg-card-hover active:scale-95 transition-all"
            >
              <span className="text-accent">{isChain ? <ListOrdered size={14} /> : <Popcorn size={14} />}</span>
              {isChain ? 'Watch order' : 'Can Watch'}
              <ChevronRight size={13} className="text-muted-foreground" />
            </Link>
          )}
          {recommendations.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRecommendations((open) => !open)}
              aria-expanded={showRecommendations}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-secondary text-secondary-foreground text-xs font-medium hover:bg-card-hover active:scale-95 transition-all"
            >
              <span className="text-accent">
                <Sparkles size={14} />
              </span>
              You may also like
              <ChevronDown
                size={13}
                className={`text-muted-foreground transition-transform duration-200 ${showRecommendations ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>
      )}

      {showRecommendations && recommendations.length > 0 && (
        <div className="px-1">
          <PosterRow
            title="You may also like"
            icon={<Sparkles size={16} />}
            items={recommendations}
            // The strongest reason only. A card carrying "Also stars Ranbir
            // Kapoor" is a suggestion; three stacked reasons is a debug dump.
            // Blank for the purely behavioural picks, which have nothing
            // specific to say beyond "people who watched this watched that".
            reasonFor={(movie) =>
              recommendations.find((r) => r.id === movie.id && r.mediaType === movie.mediaType)?.reasons[0] ?? null
            }
          />
        </div>
      )}
    </div>
  );
}
