import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { discover, getTrending, getPopularMovies, getPopularTV, getYouMayAlsoLike } from '@/lib/tmdb';
import { fetchProvidersBatch, providerKey, providerStaleTime } from '@/lib/providers';
import { buildPool } from '@/lib/duelPool';
import { nextPair, recordPick, type DuelPick, type Weights } from '@/lib/duel';
import { MOODS, rankTonight, type Mood, type TonightFilters } from '@/lib/tonight';
import { feedbackWeights, recordTonightFeedback, type TonightFeedbackKind, type TonightFeedbackMap } from '@/lib/tonightFeedback';
import type { DuelCandidate } from '@/lib/duel';
import { useWatchlistContext } from '@/contexts/watchlist-context';
import { useAuth } from '@/hooks/useAuth';
import { useDocumentMeta, siteUrl } from '@/hooks/useDocumentMeta';
import { staticRouteMeta } from '../../shared/seo';
import { languageName } from '@/lib/languages';
import { tmdbPoster } from '@/lib/tmdbImage';
import { PrivateEvaluation } from '@/components/tonight/PrivateEvaluation';

const DEFAULTS: TonightFilters = { mood: '', maxMinutes: null, language: '', services: [], includeRentBuy: false, mediaType: '' };
const COMMON_SERVICES = ['Netflix', 'Amazon Prime', 'JioHotstar', 'ZEE5', 'SonyLIV'];
const CONTROL = 'w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground';

export default function Tonight() {
  useDocumentMeta(staticRouteMeta('/tonight', siteUrl()));
  const wl = useWatchlistContext();
  const { isAuthenticated } = useAuth();
  const [filters, setFilters] = useState<TonightFilters>(DEFAULTS);
  const [weights, setWeights] = useState<Weights>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TonightFeedbackMap>({});
  const [showResults, setShowResults] = useState(false);
  const [offset, setOffset] = useState(0);
  const pendingSaves = useRef(new Set<string>());
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  const [saveErrors, setSaveErrors] = useState<Set<string>>(() => new Set());
  const trending = useQuery({ queryKey: ['tmdb', 'trending'], queryFn: getTrending, staleTime: 60 * 60_000, retry: false });
  const films = useQuery({ queryKey: ['tmdb', 'popular-movies'], queryFn: getPopularMovies, staleTime: 60 * 60_000, retry: false });
  const shows = useQuery({ queryKey: ['tmdb', 'popular-tv'], queryFn: getPopularTV, staleTime: 60 * 60_000, retry: false });
  const seed = [...wl.watchlist, ...wl.watchLater].sort((a, b) => b.addedAt - a.addedAt)[0];
  const recommended = useQuery({ queryKey: ['tmdb', 'you-may-also-like', seed?.mediaType, seed?.id],
    queryFn: () => getYouMayAlsoLike(seed.mediaType, seed.id), enabled: Boolean(seed), staleTime: 60 * 60_000, retry: false });
  const discovery = useQuery({ queryKey: ['tonight-discover', filters.mediaType, filters.language, filters.mood],
    queryFn: async () => {
      const genres = { light: '35|10751', suspense: '9648|80', adventure: '10759|14', thoughtful: '18|99' };
      const types = filters.mediaType ? [filters.mediaType] : ['movie', 'tv'] as const;
      const results = await Promise.allSettled(types.flatMap(type => [1, 2, 3].map(page => discover(type, {
        page, language: filters.language, releasedOnly: true,
        genres: filters.mood === 'adventure' && type === 'movie' ? '12|28|14' : filters.mood ? genres[filters.mood] : undefined,
      }))));
      if (results.every(result => result.status === 'rejected')) throw new Error('Discovery unavailable');
      return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    }, staleTime: 60 * 60_000, retry: false });
  const sourcesReady = !discovery.isLoading && !trending.isLoading && !films.isLoading && !shows.isLoading && (!seed || !recommended.isLoading);
  const pool = useMemo(() => !sourcesReady ? [] : buildPool([
    { name: 'discovery', items: discovery.data ?? [] },
    { name: 'saved', items: [...wl.watchlist, ...wl.watchLater] },
    { name: 'recommended', items: recommended.data ?? [] },
    { name: 'trending', items: trending.data ?? [] },
    { name: 'films', items: films.data ?? [] },
    { name: 'shows', items: shows.data ?? [] },
  ], { watchedKeys: wl.watchedKeys, limit: 80, random: () => 0.5 }),
  [sourcesReady, discovery.data, wl.watchlist, wl.watchLater, wl.watchedKeys, recommended.data, trending.data, films.data, shows.data]);
  const cacheKey = pool.map(item => providerKey(item.mediaType, item.id)).sort().join(',');
  const details = useQuery({ queryKey: ['providers', cacheKey], queryFn: () => fetchProvidersBatch(pool),
    enabled: pool.length > 0, staleTime: providerStaleTime, retry: false });
  const candidates = pool.map(item => ({ ...item,
    runtime: details.data?.runtimes[providerKey(item.mediaType, item.id)],
    genres: details.data?.genres[providerKey(item.mediaType, item.id)],
  }));
  const remaining = candidates.filter(item => !feedback[providerKey(item.mediaType, item.id)]);
  const choices = rankTonight(remaining, filters, weights,
    (type, id) => details.data?.availability?.[providerKey(type, id)], feedbackWeights(feedback));
  const pair = nextPair(choices.map(choice => choice.candidate), {}, new Set());
  const services = [...new Set([...COMMON_SERVICES, ...Object.values(details.data?.availability ?? {}).flat().map(offer => offer.provider)])].sort();
  const languages = [...new Set(['en', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', ...candidates.map(candidate => candidate.originalLanguage?.toLowerCase()).filter(Boolean)])].sort((a, b) => languageName(a).localeCompare(languageName(b)));
  const busy = !sourcesReady || (pool.length > 0 && details.isLoading);
  const discoveryFailed = discovery.isError || trending.isError || films.isError || shows.isError || (Boolean(seed) && recommended.isError);
  const saved = new Set([...wl.watchlist, ...wl.watchLater, ...Object.values(wl.customListItems).flat()].map(item => providerKey(item.mediaType, item.id)));
  const update = (change: Partial<TonightFilters>) => { setFilters(current => ({ ...current, ...change })); setOffset(0); };
  const pick = (choice: DuelPick) => { setWeights(recordPick({}, choice)); setPicked(providerKey(choice.winner.mediaType, choice.winner.id)); setOffset(0); };
  const giveFeedback = (candidate: DuelCandidate, kind: TonightFeedbackKind) => {
    const key = providerKey(candidate.mediaType, candidate.id);
    setFeedback(current => ({ ...current, [key]: recordTonightFeedback(candidate, kind) }));
    if (picked === key) { setWeights({}); setPicked(null); }
    setOffset(0);
  };
  const visible = choices.slice(offset, offset + 3);
  const save = async (candidate: DuelCandidate) => {
    const key = providerKey(candidate.mediaType, candidate.id);
    if (pendingSaves.current.has(key)) return;
    pendingSaves.current.add(key);
    setSaving(new Set(pendingSaves.current));
    setSaveErrors(current => { const next = new Set(current); next.delete(key); return next; });
    try {
      if (!await wl.addToWatchlistAsync(candidate)) throw new Error('Not signed in');
    } catch {
      setSaveErrors(current => new Set(current).add(key));
    } finally {
      pendingSaves.current.delete(key);
      setSaving(new Set(pendingSaves.current));
    }
  };

  return <div className="mx-auto max-w-4xl space-y-6 pb-10">
    <header className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent"><Sparkles size={14} /> Make a choice</p>
      <h1 className="font-display text-3xl sm:text-4xl font-bold">What are we watching tonight?</h1>
      <p className="text-sm text-muted-foreground">Choose what matters, or skip everything. We use genres as a rough guide to mood.</p>
    </header>
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs font-semibold">Mood<select className={CONTROL} value={filters.mood} onChange={e => update({ mood: e.target.value as Mood | '' })}><option value="">Any mood</option>{Object.entries(MOODS).map(([key, mood]) => <option key={key} value={key}>{mood.label}</option>)}</select></label>
        <label className="space-y-1 text-xs font-semibold">Time available<select className={CONTROL} value={filters.maxMinutes ?? ''} onChange={e => update({ maxMinutes: e.target.value ? Number(e.target.value) : null })}><option value="">Any length</option><option value="45">Up to 45 minutes</option><option value="90">Up to 90 minutes</option><option value="120">Up to 2 hours</option><option value="180">Up to 3 hours</option></select></label>
        <label className="space-y-1 text-xs font-semibold">Original language<select className={CONTROL} value={filters.language} onChange={e => update({ language: e.target.value })}><option value="">Any language</option>{languages.map(code => <option key={code} value={code}>{languageName(code)}</option>)}</select></label>
        <label className="space-y-1 text-xs font-semibold">Format<select className={CONTROL} value={filters.mediaType} onChange={e => update({ mediaType: e.target.value as TonightFilters['mediaType'] })}><option value="">Movies or shows</option><option value="movie">Movies</option><option value="tv">Shows</option></select></label>
      </div>
      <p className="text-xs text-muted-foreground">For shows, the time limit applies to a typical episode where known.</p>
      <fieldset className="space-y-2"><legend className="text-xs font-semibold">Your services in India <span className="font-normal text-muted-foreground">(optional)</span></legend>
        <div className="flex flex-wrap gap-2">{services.map(service => <label key={service} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-xs"><input type="checkbox" checked={filters.services.includes(service)} onChange={() => update({ services: filters.services.includes(service) ? filters.services.filter(s => s !== service) : [...filters.services, service] })} />{service}</label>)}</div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={filters.includeRentBuy} onChange={e => update({ includeRentBuy: e.target.checked })} /> Include rentals and purchases when matching services</label>
        <p className="text-xs text-muted-foreground">Availability: JustWatch via TMDB. It can change. When a service, time or language is selected, titles with unknown values are excluded.</p>
      </fieldset>
      {pair && <fieldset className="space-y-2"><legend className="text-xs font-semibold">A quick Duel <span className="font-normal text-muted-foreground">(optional)</span></legend>
        <p className="text-xs text-muted-foreground">Which would you rather watch? Your choice adjusts this session&rsquo;s ranking.</p>
        <div className="flex flex-wrap gap-2">{[pair[0], pair[1]].map((candidate, i) => <button type="button" key={providerKey(candidate.mediaType, candidate.id)} aria-pressed={picked === providerKey(candidate.mediaType, candidate.id)} onClick={() => pick({ winner: candidate, loser: pair[1 - i] })} className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs hover:border-accent">{candidate.title}</button>)}{picked && <button type="button" className="text-xs underline" onClick={() => { setWeights({}); setPicked(null); setOffset(0); }}>Clear choice</button>}</div>
      </fieldset>}
      <button type="button" disabled={busy} onClick={() => { setOffset(0); setShowResults(true); }} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50">{busy ? 'Finding options…' : 'Find something to watch'}</button>
    </div>
    {discoveryFailed && <div role="status" className="text-sm text-muted-foreground">Some discovery sources could not load. Available sources are still included. <button type="button" className="underline" onClick={() => { if (discovery.isError) void discovery.refetch(); if (trending.isError) void trending.refetch(); if (films.isError) void films.refetch(); if (shows.isError) void shows.refetch(); if (seed && recommended.isError) void recommended.refetch(); }}>Try again</button></div>}
    {details.isError && <div role="status" className="text-sm text-muted-foreground">Availability and runtime could not be checked. Remove those filters or <button type="button" className="underline" onClick={() => void details.refetch()}>try again</button>.</div>}
    {!details.isError && details.data?.hadFailures && <div role="status" className="text-sm text-muted-foreground">Some availability and runtime checks failed, so filters may hide options. Available results are still shown. <button type="button" className="underline" onClick={() => void details.refetch()}>Try those checks again</button></div>}
    {showResults && <section aria-labelledby="tonight-results" className="space-y-3"><h2 id="tonight-results" className="font-display text-xl font-semibold">Your options</h2>
      {Object.keys(feedback).length > 0 && <p className="text-xs text-muted-foreground" role="status">Feedback is used only in this session. <button type="button" className="underline" onClick={() => { setFeedback({}); setOffset(0); }}>Clear feedback</button></p>}
      {visible.length === 0 ? <p className="rounded-xl bg-card p-4 text-sm text-muted-foreground">No matches with the information available. Try fewer filters, allow rentals, or try <Link className="underline" to="/duel">the full Duel</Link>.</p> : <div className="grid gap-3 sm:grid-cols-3">{visible.map(({ candidate, reasons, offers }) => {
        const poster = tmdbPoster(candidate.posterPath ? `https://image.tmdb.org/t/p/w342${candidate.posterPath}` : null, 96);
        return <article key={providerKey(candidate.mediaType, candidate.id)} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex gap-3">{poster && <img src={poster.src} alt="" className="w-16 rounded-lg object-cover self-start" />}<div><h3 className="font-semibold">{candidate.title}</h3><p className="text-xs text-muted-foreground">{candidate.mediaType === 'tv' ? 'Series' : 'Film'}</p></div></div>
          <ul className="space-y-1 text-xs text-muted-foreground">{reasons.map(reason => <li key={reason}>• {reason}</li>)}</ul>
          {offers?.length && filters.services.length === 0 ? <p className="text-xs text-muted-foreground">Reported in India: {[...new Set(offers.map(offer => `${offer.provider} (${offer.type === 'ads' ? 'with ads' : offer.type})`))].join(' · ')}</p> : null}
          {!offers?.length && <p className="text-xs text-muted-foreground">Availability unknown in India</p>}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label={`Feedback for ${candidate.title}`}>
            <button type="button" className="underline" onClick={() => giveFeedback(candidate, 'not_interested')}>Not for me</button>
            <button type="button" className="underline" onClick={() => giveFeedback(candidate, 'already_watched')}>Already watched</button>
            <button type="button" className="underline" onClick={() => giveFeedback(candidate, 'not_available')}>Not available</button>
          </div>
          <div className="mt-auto flex flex-wrap gap-3 text-xs font-semibold"><Link className="text-accent underline" to={`/title/${candidate.mediaType}/${candidate.id}`}>See where to watch</Link>{isAuthenticated ? <button type="button" disabled={saved.has(providerKey(candidate.mediaType, candidate.id)) || saving.has(providerKey(candidate.mediaType, candidate.id))} onClick={() => void save(candidate)} className="underline disabled:opacity-60">{saved.has(providerKey(candidate.mediaType, candidate.id)) ? 'Saved' : saving.has(providerKey(candidate.mediaType, candidate.id)) ? 'Saving…' : 'Save'}</button> : <Link to="/login" className="underline">Sign in to save</Link>}</div>
          {saveErrors.has(providerKey(candidate.mediaType, candidate.id)) && <p role="alert" className="text-xs text-muted-foreground">Could not save this title. Please try again.</p>}
        </article>;
      })}</div>}
      <p className="text-xs text-muted-foreground">Optional feedback stays in this session. “Not for me” hides that title and gently lowers similar genres; the other options hide only that title.</p>
      {choices.length > 3 && <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs" onClick={() => setOffset((offset + 3) >= choices.length ? 0 : offset + 3)}>More options</button>}
    </section>}
    {showResults && <PrivateEvaluation candidates={candidates} filters={filters} weights={weights} feedback={feedback}
      availability={details.data?.availability ?? {}} disabled={busy} />}
  </div>;
}
