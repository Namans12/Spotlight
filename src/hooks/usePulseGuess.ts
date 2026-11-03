import { useCallback, useEffect, useRef, useState } from 'react';
import type { Campaign } from '../../shared/types/pulse';
import { fetchGuess, type TitleParams } from '@/lib/pulseApi';
import { guessErrorMessage } from '@/lib/pulseCopy';

export type GuessState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; campaign: Campaign };

/**
 * The "without Qloo" guess. It is an LLM call that spends the daily budget, so
 * nothing here fetches until `load` is called (from a click), and an in-flight
 * request is abandoned when the page goes away or a newer load starts. The
 * result is kept, so hiding and re-showing the comparison costs nothing.
 */
export function usePulseGuess(params: TitleParams): { state: GuessState; load: () => void } {
  const [state, setState] = useState<GuessState>({ status: 'idle' });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const { city, type, mediaType, tmdbId } = params;
  const load = useCallback(() => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setState({ status: 'loading' });
    fetchGuess({ city, type, mediaType, tmdbId }, ac.signal).then(
      (campaign) => {
        if (!ac.signal.aborted) setState({ status: 'ready', campaign });
      },
      (err) => {
        if (!ac.signal.aborted) setState({ status: 'error', message: guessErrorMessage(err) });
      },
    );
  }, [city, type, mediaType, tmdbId]);

  return { state, load };
}
