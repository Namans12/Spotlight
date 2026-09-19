import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import type { CastMember } from '@/lib/tmdb';
import { tmdbProfile } from '@/lib/tmdbImage';

interface CastRowProps {
  cast: CastMember[];
  /** Rendered ahead of the cast, as the first card. TMDB bills the director
   *  as crew, but a reader looking for "who made this" is looking in the same
   *  place they look for "who is in it". */
  director?: { id: number; name: string; profilePath: string | null } | null;
}

const AVATAR_PX = 64;

/**
 * The billed cast, as a horizontally scrolling row of faces.
 *
 * Every card is a link, which is the whole point — a cast list that cannot be
 * followed is decoration. Tapping a face answers "what else have I seen them
 * in", which is the question the name prompts in the first place.
 */
export function CastRow({ cast, director }: CastRowProps) {
  const entries: { id: number; name: string; profilePath: string | null; role: string | null }[] = [
    ...(director ? [{ ...director, role: 'Director' }] : []),
    // The director is often also billed in the cast (a cameo, or a voice part
    // in animation). Showing them twice in the first two cards looks like a
    // bug, so the leading director card wins.
    ...cast.filter((c) => c.id !== director?.id).map((c) => ({ ...c, role: c.character })),
  ];

  if (entries.length === 0) return null;

  return (
    <section className="px-1">
      <h2 className="font-display text-lg font-semibold text-foreground mb-3 leading-none">Cast &amp; crew</h2>
      {/* -mx/px pair so the row bleeds to the screen edge while its first and
          last cards still clear the page gutter when scrolled to either end. */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 hide-scrollbar snap-x">
        {entries.map((person) => {
          const photo = tmdbProfile(person.profilePath, AVATAR_PX);
          return (
            <Link
              key={`${person.id}-${person.role ?? ''}`}
              to={`/person/${person.id}`}
              className="shrink-0 w-[76px] text-center snap-start group"
            >
              <div className="w-16 h-16 mx-auto rounded-full overflow-hidden bg-secondary ring-1 ring-border group-hover:ring-accent transition-all flex items-center justify-center">
                {photo ? (
                  <img
                    src={photo.src}
                    srcSet={photo.srcSet}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User size={22} className="text-muted-foreground" aria-hidden />
                )}
              </div>
              <p className="mt-1.5 text-[11px] font-medium text-foreground leading-tight line-clamp-2">
                {person.name}
              </p>
              {person.role && (
                <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2 mt-0.5">{person.role}</p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
