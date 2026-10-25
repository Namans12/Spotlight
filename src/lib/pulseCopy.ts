// Wording the brief shares between components and its tests.
import type { BriefSectionKey } from '../../shared/types/pulse';
import { PulseApiError } from './pulseApi';

export const SECTION_TITLES: Record<BriefSectionKey, string> = {
  who: 'Who',
  where: 'Where',
  venues: 'Venues',
  themes: 'Venue food themes',
  artists: 'Global artists',
  brands: 'Global food and drink brands',
  hook: 'Local hook',
  trend: 'Trend',
  campaign: 'Campaign ideas',
};

export const GUESS_LABEL = 'What an LLM guesses with no taste data';

/** What the "Compare without Qloo" panel says for each way the guess can fail. */
export function guessErrorMessage(err: unknown): string {
  if (err instanceof PulseApiError) {
    if (err.code === 'daily_limit') return 'Daily AI limit reached — try again tomorrow';
    if (err.code === 'llm_unavailable') return 'The AI writer isn’t configured on this deployment.';
    if (err.code === 'rate_limited') {
      return err.retryAfterSeconds
        ? `Too many requests right now — try again in ${err.retryAfterSeconds} ${err.retryAfterSeconds === 1 ? 'second' : 'seconds'}.`
        : 'Too many requests right now — give it a moment, then try again.';
    }
  }
  return 'Couldn’t get the comparison. Check your connection and try again.';
}
