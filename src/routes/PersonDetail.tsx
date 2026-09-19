import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, User } from 'lucide-react';
import { getPerson, type PersonCredit } from '@/lib/tmdb';
import { ReleaseGrid } from '@/components/release/ReleaseGrid';
import { useRatings } from '@/hooks/useRatings';
import { fromMovie } from '@/types/digest';
import { tmdbProfile } from '@/lib/tmdbImage';
import { formatDate } from '@/lib/format';
import { personMeta } from '../../shared/seo';
import { useDocumentMeta, siteUrl } from '@/hooks/useDocumentMeta';

type Filter = 'all' | 'movie' | 'tv';

/**
 * A person, and everything they have been in.
 *
 * This is the page a cast list is *for*. "Also stars Ranbir Kapoor" on a
 * recommendation card is only useful if the name is a door, and until now it
 * wasn't one — the app knew the cast of everything and could show you the
 * work of nobody.
 */
export default function PersonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => (location.key === 'default' ? navigate('/') : navigate(-1));
  const personId = Number(id);
  const [filter, setFilter] = useState<Filter>('all');
  const [bioOpen, setBioOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tmdb', 'person', personId],
    queryFn: () => getPerson(personId),
    enabled: Number.isFinite(personId) && personId > 0,
    staleTime: 24 * 60 * 60_000,
  });

  const credits: PersonCredit[] = useMemo(
    () => (data?.credits ?? []).filter((c) => filter === 'all' || c.mediaType === filter),
    [data, filter],
  );

  // Hooks cannot be conditional, so both of these sit above the loading guard.
  const ratingFor = useRatings(credits);
  useDocumentMeta(data ? personMeta(data, siteUrl()) : null);

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
        <BackButton onClick={goBack} />
        <p className="text-sm text-muted-foreground">Could not load this person.</p>
      </div>
    );
  }

  const photo = tmdbProfile(data.profilePath, 96);
  const counts = {
    all: data.credits.length,
    movie: data.credits.filter((c) => c.mediaType === 'movie').length,
    tv: data.credits.filter((c) => c.mediaType === 'tv').length,
  };

  return (
    <div className="space-y-5">
      <BackButton onClick={goBack} />

      <header className="flex gap-4 items-start px-1">
        <div className="w-24 h-24 rounded-2xl overflow-hidden bg-secondary shrink-0 flex items-center justify-center ring-1 ring-border">
          {photo ? (
            <img src={photo.src} srcSet={photo.srcSet} alt="" decoding="async" className="w-full h-full object-cover" />
          ) : (
            <User size={32} className="text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground leading-tight">{data.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
            {data.knownFor && <span className="font-semibold uppercase text-accent">{data.knownFor}</span>}
            {data.birthday && <span>{lifespan(data.birthday, data.deathday)}</span>}
            {data.placeOfBirth && <span className="truncate">{data.placeOfBirth}</span>}
          </div>
        </div>
      </header>

      {data.biography && (
        <div className="px-1">
          <p className={`text-sm text-foreground/90 leading-relaxed ${bioOpen ? '' : 'line-clamp-3'}`}>
            {data.biography}
          </p>
          <button
            type="button"
            onClick={() => setBioOpen((open) => !open)}
            aria-expanded={bioOpen}
            className="mt-1 text-xs font-medium text-accent hover:underline"
          >
            {bioOpen ? 'Read less' : 'Read more'}
          </button>
        </div>
      )}

      {data.credits.length > 0 && (
        <div className="px-1 space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-lg font-semibold text-foreground">Known for</h2>
            {/* Only worth offering when there is genuinely a mix. A film-only
                actor does not need a "Films" tab that changes nothing. */}
            {counts.movie > 0 && counts.tv > 0 && (
              <div className="flex gap-1.5">
                {(['all', 'movie', 'tv'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                      filter === value
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-card-hover'
                    }`}
                  >
                    {value === 'all' ? 'All' : value === 'movie' ? 'Films' : 'Series'} {counts[value]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ReleaseGrid items={credits.map(fromMovie)} linkBase="/title" ratingFor={ratingFor} />
        </div>
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft size={14} className="shrink-0" /> Back
    </button>
  );
}

/** "b. 12 Aug 1962" while living, "1962 – 2019" once there is a death date. */
function lifespan(birthday: string, deathday: string | null): string {
  if (deathday) return `${birthday.slice(0, 4)} – ${deathday.slice(0, 4)}`;
  return `b. ${formatDate(birthday) ?? birthday}`;
}
