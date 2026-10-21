// Wording and rules the Pulse chat shares between its state hook, its
// components and their tests.
import type { BusinessType } from '../../shared/types/pulse';
import { PulseApiError } from './pulseApi';
import { businessTypeLabel } from './pulseCities';

/** The server keeps the last 12 messages and refuses the rest of the request
 *  if the last one is not the user's. Matches MAX_MESSAGES in services/pulse. */
export const CHAT_WINDOW = 12;
/** Matches MAX_CONTENT_CHARS in services/pulse; the textarea enforces it too. */
export const CHAT_MAX_CHARS = 4000;

export interface WireMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** The last 12 text messages, in the shape the server accepts. Tool lines and
 *  system lines are not conversation and never leave the browser. */
export function toWire(messages: readonly WireMessage[]): WireMessage[] {
  return messages.slice(-CHAT_WINDOW).map((m) => ({ role: m.role, content: [...m.content].slice(0, CHAT_MAX_CHARS).join('') }));
}

// ---------------------------------------------------------------------------
// Tool lines
// ---------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  pulse_board: 'Looked at the release board',
  release_brief: 'Read a release brief',
  search_releases: "Searched this week's releases",
  titles_shot_in: 'Looked up titles shot in a city',
  qloo_recommend: 'Asked Qloo for recommendations',
  qloo_where_popular: 'Asked Qloo where something is popular',
  qloo_audience_demographics: 'Asked Qloo about audience skew',
  qloo_rank: 'Asked Qloo to rank options',
  qloo_compare_audiences: 'Asked Qloo to compare audiences',
  qloo_find_tags: 'Looked up Qloo tags',
  qloo_describe: 'Looked up an entity in Qloo',
};

/** A friendly sentence for a tool call. "Qloo" appears only for qloo_* tools,
 *  so the page never credits Qloo with something it did not do. */
export function toolLabel(name: string): string {
  return Object.prototype.hasOwnProperty.call(TOOL_LABELS, name) ? TOOL_LABELS[name] : `Used the tool ${name}`;
}

// ---------------------------------------------------------------------------
// Failures before the stream starts
// ---------------------------------------------------------------------------

export interface FailureLine {
  text: string;
  /** Offer "Try again": only for failures a second attempt could fix. */
  retry: boolean;
}

export const UNREACHABLE = "Couldn't reach Pulse — check your connection and try again.";

export function failureLine(err: unknown): FailureLine {
  if (err instanceof PulseApiError) {
    switch (err.code) {
      case 'daily_limit':
        return { text: 'Daily AI limit reached — try again tomorrow.', retry: false };
      case 'too_many_streams':
        return { text: 'Pulse is already answering two of your questions — wait a moment and try again.', retry: false };
      case 'rate_limited': {
        const s = err.retryAfterSeconds;
        return { text: `You're asking quickly — try again in ${s ? `${s} ${s === 1 ? 'second' : 'seconds'}` : 'a moment'}.`, retry: false };
      }
      case 'llm_unavailable':
        return { text: "The AI assistant isn't configured on this deployment.", retry: false };
      case 'too_large':
      case 'bad_request':
        return { text: "That message couldn't be sent — try a shorter question.", retry: false };
    }
  }
  return { text: UNREACHABLE, retry: true };
}

// ---------------------------------------------------------------------------
// Suggested prompts
// ---------------------------------------------------------------------------

/** Each prompt names the city and business type: the model is told nothing
 *  about the page, so the words have to carry them. */
export function suggestedPrompts(cityName: string, type: BusinessType, title?: string): string[] {
  const noun = type === 'cafe' ? 'café' : type === 'd2c_food' ? 'brand' : businessTypeLabel(type).toLowerCase();
  const prompts = [`Which release should my ${cityName} ${noun} theme this weekend around?`];
  if (title) prompts.push(`Who is the audience for ${title} in ${cityName}?`);
  prompts.push(`Plan a screening-night special for Friday at my ${cityName} ${noun}.`);
  return prompts;
}
