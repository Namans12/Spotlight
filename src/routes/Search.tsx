import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, Loader2, Globe } from 'lucide-react';
import { Movie } from '@/types/movie';
import { searchMovies } from '@/lib/tmdb';
import { PosterCard } from '@/components/release/PosterCard';
import { FilterSelect } from '@/components/ui/filter-select';
import { fromMovie } from '@/types/digest';
import { useWatchlistContext } from '@/contexts/WatchlistContext';
import { useMediaScope } from '@/hooks/useMediaScope';
import { useSeasons } from '@/hooks/useSeasons';
import { useProviders } from '@/hooks/useProviders';
import { languageName, compareByLanguageName } from '@/lib/languages';

export default function Search() {
  const wl = useWatchlistContext();
  const [params, setParams] = useSearchParams();
  const [mediaType] = useMediaScope();
  const [query, setQuery] = useState(params.get('q') || '');
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const data = await searchMovies(q);
      setResults(data);
      if (data.length === 0) setError('No results found. Try a different search term.');
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Run the search once on mount if the URL already carries a query (deep link / reload).
  useEffect(() => {
    const initial = params.get('q');
    if (initial) runSearch(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The topbar's Movies/Shows scope narrows what TMDB gave back, rather than
  // issuing a second, differently-scoped request.
  const scoped = mediaType === 'all' ? results : results.filter((m) => m.mediaType === mediaType);

  // Comma-joined in the URL so a deep link can carry more than one language
  // (e.g. ?language=hi,ta) the same way the Calendar language filter does.
  const languages = useMemo(() => {
    const raw = params.get('language');
    return raw ? raw.split(',').filter(Boolean) : [];
  }, [params]);
  // Options come from the media-scoped results (not yet language-filtered) so
  // picking a language never makes other options disappear from the menu.
  const languageOptions = useMemo(() => {
    const byName = new Map<string, string>();
    for (const m of scoped) {
      if (!m.originalLanguage) continue;
      const name = languageName(m.originalLanguage);
      if (!byName.has(name)) byName.set(name, m.originalLanguage);
    }
    return [...byName.values()].sort(compareByLanguageName);
  }, [scoped]);

  // Matched by display name, not raw code, so a data quirk like 'cn'/'zh' both
  // meaning Chinese doesn't split into two silently-different filter options.
  const selectedLanguageNames = useMemo(() => new Set(languages.map(languageName)), [languages]);
  const visible =
    selectedLanguageNames.size > 0
      ? scoped.filter((m) => m.originalLanguage && selectedLanguageNames.has(languageName(m.originalLanguage)))
      : scoped;
  const selectedLanguageLabel = [...selectedLanguageNames].join(', ');
  const seasonsFor = useSeasons(visible);
  const providersFor = useProviders(visible);

  function updateLanguages(next: string[]) {
    const updated = new URLSearchParams(params);
    if (next.length === 0) updated.delete('language');
    else updated.set('language', next.join(','));
    setParams(updated, { replace: true });
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    // Merge rather than replace: a bare { q } would drop the topbar's ?type.
    const next = new URLSearchParams(params);
    next.set('q', query);
    setParams(next, { replace: true });
    runSearch(query);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-3.5 inline-flex items-center">
            <SearchIcon size={16} className="text-muted-foreground shrink-0" />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies, TV shows, anime..."
            className="h-control-lg w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-control-lg shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold leading-none text-accent-foreground transition-all hover:brightness-110 disabled:opacity-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin shrink-0" /> : <SearchIcon size={16} className="shrink-0" />}
          <span className="hidden sm:inline">{loading ? 'Searching...' : 'Search'}</span>
        </button>
      </form>

      {error && (
        <div className="p-3 bg-danger/10 border border-danger/20 rounded-xl">
          <p className="text-xs text-danger font-medium">{error}</p>
        </div>
      )}

      {languageOptions.length > 0 && (
        <FilterSelect
          multiple
          label="Language"
          allLabel="All languages"
          icon={<Globe size={13} />}
          value={languages}
          onChange={updateLanguages}
          options={languageOptions}
          getLabel={languageName}
        />
      )}

      {visible.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {visible.length} {visible.length === 1 ? 'result' : 'results'}
          {mediaType !== 'all' && ` in ${mediaType === 'movie' ? 'movies' : 'shows'}`}
          {selectedLanguageLabel && ` · ${selectedLanguageLabel}`}
        </p>
      )}

      {results.length > 0 && scoped.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {results.length} {results.length === 1 ? 'result' : 'results'}, but none are{' '}
          {mediaType === 'movie' ? 'movies' : 'shows'} — switch to All in the topbar to see them.
        </p>
      )}

      {scoped.length > 0 && visible.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {scoped.length} {scoped.length === 1 ? 'result' : 'results'}, but none in {selectedLanguageLabel} —{' '}
          <button type="button" onClick={() => updateLanguages([])} className="text-accent hover:underline">
            clear the language filter
          </button>
          .
        </p>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
        {visible.map((movie) => (
          <PosterCard
            key={movie.id}
            item={fromMovie(movie)}
            linkTo={`/title/${movie.mediaType}/${movie.id}`}
            seasons={seasonsFor(movie.mediaType, movie.id)}
            providers={providersFor(movie.mediaType, movie.id)}
            onAddToWatchlist={() => wl.addToWatchlist(movie)}
            onAddToWatchLater={() => wl.addToWatchLater(movie)}
            onToggleWatched={() => wl.toggleWatched(movie)}
            watched={wl.isWatched(movie.mediaType, movie.id)}
          />
        ))}
      </div>

      {!searched && !loading && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <SearchIcon size={40} className="mb-3 opacity-30 shrink-0" />
          <p className="text-sm font-medium">Search for movies & TV shows</p>
          <p className="text-xs mt-1 opacity-60">Hindi, English, Korean, and 100+ languages</p>
        </div>
      )}
    </div>
  );
}
