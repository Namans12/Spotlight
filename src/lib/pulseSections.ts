/**
 * Which sections a brief shows, and how the streamed events assemble into the
 * page's state.
 */
import type { BriefEvent, BriefHeader, BriefSectionKey, BusinessType, EvidenceSection } from '../../shared/types/pulse';

/** Display order per business type. Mirrors `BUSINESS_TYPES[...].sections` in
 *  services/pulse/src/businessTypes.ts (not imported: that module is the
 *  service's, with its server-only dependencies). The page orders by this, not
 *  by arrival, because the service sends sections as they finish. */
export const BRIEF_SECTIONS: Record<BusinessType, readonly BriefSectionKey[]> = {
  cafe: ['who', 'where', 'venues', 'themes', 'artists', 'hook', 'trend', 'campaign'],
  d2c_food: ['who', 'where', 'themes', 'brands', 'artists', 'hook', 'trend', 'campaign'],
};

export interface BriefState {
  header: BriefHeader | null;
  sections: Partial<Record<BriefSectionKey, EvidenceSection<unknown>>>;
  /** Sections from an earlier attempt, still shown until this attempt's own arrive. */
  stale: Partial<Record<BriefSectionKey, true>>;
  /** The `done` event arrived: nothing more is coming. */
  done: boolean;
  /** The stream closed without `done`: what is here is incomplete. */
  interrupted: boolean;
}

export const initialBriefState: BriefState = { header: null, sections: {}, stale: {}, done: false, interrupted: false };

export type BriefAction = { type: 'begin' } | { type: 'event'; event: BriefEvent } | { type: 'ended' };

/**
 * `begin` starts an attempt. Whatever the last attempt left stays on screen,
 * marked stale, and is replaced section by section as the new events arrive;
 * what the new attempt never sends is dropped at `done`. That way a Retry does
 * not blank the page, and a section that failed to load again is not shown as
 * if it were fresh.
 */
export function briefReducer(state: BriefState, action: BriefAction): BriefState {
  switch (action.type) {
    case 'begin': {
      const stale: BriefState['stale'] = {};
      for (const key of Object.keys(state.sections) as BriefSectionKey[]) stale[key] = true;
      return { ...state, stale, done: false, interrupted: false };
    }
    case 'event': {
      const e = action.event;
      if (e.type === 'header') return { ...state, header: e.header };
      if (e.type === 'section') {
        const stale = { ...state.stale };
        delete stale[e.key];
        return { ...state, sections: { ...state.sections, [e.key]: e.section }, stale };
      }
      const sections = { ...state.sections };
      for (const key of Object.keys(state.stale) as BriefSectionKey[]) delete sections[key];
      return { ...state, sections, stale: {}, done: true, interrupted: false };
    }
    case 'ended':
      return state.done ? state : { ...state, interrupted: true };
  }
}

export type SectionView =
  | { kind: 'loading' }
  /** The stream finished and never sent this section. */
  | { kind: 'missing' }
  | { kind: 'section'; section: EvidenceSection<unknown>; stale: boolean };

export function sectionView(state: BriefState, key: BriefSectionKey): SectionView {
  const section = state.sections[key];
  if (section) return { kind: 'section', section, stale: state.stale[key] === true };
  return state.done ? { kind: 'missing' } : { kind: 'loading' };
}

/** The title of the service's placeholder idea (FALLBACK_IDEA in
 *  services/pulse/src/campaign.ts), sent when no attempt produced a usable draft. */
const FALLBACK_TITLE = 'Campaign draft unavailable';

/**
 * Whether the campaign section may be called grounded in Qloo taste data: it
 * came back ok, says it was grounded, and is a real draft rather than the
 * placeholder. Anything else gets a neutral heading.
 */
export function isGroundedCampaign(section: EvidenceSection<unknown> | undefined): boolean {
  if (!section || section.status !== 'ok') return false;
  const c = section.data as { groundedBy?: unknown; ideas?: { title?: unknown }[] } | null;
  if (!c || c.groundedBy !== 'qloo' || !Array.isArray(c.ideas) || c.ideas.length === 0) return false;
  return !(c.ideas.length === 1 && c.ideas[0]?.title === FALLBACK_TITLE);
}
