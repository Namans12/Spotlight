import { Play } from 'lucide-react';

interface TrailerCardProps {
  trailer: { key: string; site: 'YouTube'; name: string };
}

/**
 * A link to the trailer, not a player.
 *
 * An embedded YouTube iframe loads YouTube's own script and sets YouTube's
 * own cookies on every title page view — for every reader, whether or not
 * they ever press play. That is a third-party tracking surface added
 * entirely to get a thumbnail with a play button drawn on it.
 *
 * The thumbnail here is a plain static image fetched from YouTube's image
 * host (`img.youtube.com`, not `youtube.com` itself) — one GET, no script, no
 * player, no tracking cookie. Clicking through is a normal outbound link,
 * opened in a new tab, to the real YouTube page: the reader who wants to
 * watch it gets exactly what an embed would have given them, and the reader
 * who doesn't never paid YouTube's cost.
 */
export function TrailerCard({ trailer }: TrailerCardProps) {
  return (
    <section className="px-1">
      <h2 className="font-display text-lg font-semibold text-foreground mb-2.5">Trailer</h2>
      <a
        href={`https://www.youtube.com/watch?v=${trailer.key}`}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative block w-full max-w-md rounded-xl overflow-hidden bg-secondary aspect-video ring-1 ring-border hover:ring-accent transition-all"
      >
        <img
          // hqdefault exists for every YouTube video; maxresdefault does not
          // (older or lower-resolution uploads lack it), and there is no way
          // to know which a given key has without a second request just to
          // find out. hqdefault is the one size guaranteed to load.
          src={`https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-background/80 backdrop-blur-sm text-foreground group-hover:scale-105 transition-transform">
            <Play size={22} fill="currentColor" className="ml-0.5" />
          </span>
        </div>
        <p className="absolute bottom-0 inset-x-0 px-3 py-2 text-xs font-medium text-white bg-gradient-to-t from-black/70 to-transparent line-clamp-1">
          {trailer.name}
        </p>
      </a>
    </section>
  );
}
