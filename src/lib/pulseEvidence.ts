/**
 * Evidence chips: what a campaign clause cites, turned into labels a reader can
 * check. The service's campaign writer cites ids from a fact bundle it built
 * from the brief's sections (services/pulse/src/campaign.ts `buildBundle`):
 *
 *   demo:<ageBucket|male|female>  heat:<i>  venue:<id>  tag:<id>
 *   artist:<id>  brand:<id>  hook:<filmed|set>
 *
 * The SPA has the same sections, so every id can be mapped to its label and,
 * when the section is on hand, to the underlying context. Resolving an id
 * checks the reference, not the generated proposal. Missing or unresolvable
 * references are labelled Agent suggestion.
 */
import type {
  AgeBucket, BriefSectionKey, EvidenceSection, HeatCell, LocalHook, NamedEntity, TagAffinity, Venue,
} from '../../shared/types/pulse';

/** The brief's sections as collected so far (the `bundle` the chips read). */
export type SectionBundle = Partial<Record<BriefSectionKey, EvidenceSection<unknown>>>;

export const AGENT_SUGGESTION = 'Agent suggestion';

export const AGE_BUCKETS: readonly AgeBucket[] = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];

export const AGE_LABELS: Record<AgeBucket, string> = {
  '24_and_younger': '24 and younger',
  '25_to_29': '25–29',
  '30_to_34': '30–34',
  '35_to_44': '35–44',
  '45_to_54': '45–54',
  '55_and_older': '55 and older',
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function arrayOf<T>(s: EvidenceSection<unknown> | undefined): T[] {
  const d = s?.data;
  return Array.isArray(d) ? (d.filter((x) => x && typeof x === 'object') as T[]) : [];
}

const tidy = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * The top `n` DISTINCT named neighbourhoods by affinity. Cells with no label
 * are skipped (they stay on the map as circles); ties keep arrival order. The
 * service numbers `heat:<i>` from the same ranking, which is what lets a chip
 * look its neighbourhood up by index.
 */
export function topNeighbourhoods(cells: HeatCell[], n = 3): { name: string; affinity: number }[] {
  const ranked = cells
    .map((c, i) => ({ c, i, name: tidy(c.neighbourhood) }))
    .filter((r) => r.name !== '')
    .sort((a, b) => (isNum(b.c.affinity) ? b.c.affinity : -Infinity) - (isNum(a.c.affinity) ? a.c.affinity : -Infinity) || a.i - b.i);
  const seen = new Set<string>();
  const out: { name: string; affinity: number }[] = [];
  for (const r of ranked) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: r.name, affinity: r.c.affinity });
    if (out.length === n) break;
  }
  return out;
}

/** The service strips everything outside this set from the ids it builds, so
 *  entity ids are compared after the same treatment. */
const idPart = (v: unknown): string => String(v ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60);

export interface ChipSpec {
  label: string;
  /** The fact behind the chip, when the bundle can resolve it. */
  detail: string | null;
}

/**
 * The chips for one local hook. Which sources back it decides the labels, and
 * a record found by both renders both. The "set" wordings are this module's
 * own (the Global Constraints name only the "filmed" ones): a title set in a
 * city reads "Films set in <City>" on Wikipedia and "narrative location" on
 * Wikidata, the property Wikidata uses for where a story takes place.
 */
export function hookChips(hook: Pick<LocalHook, 'kind' | 'source'>, cityName: string): string[] {
  const filmed = hook.kind === 'filmed';
  const wikipedia = filmed ? `Wikipedia · Films shot in ${cityName}` : `Wikipedia · Films set in ${cityName}`;
  const wikidata = filmed ? 'Wikidata · filming location' : 'Wikidata · narrative location';
  if (hook.source === 'both') return [wikipedia, wikidata];
  return [hook.source === 'wikidata' ? wikidata : wikipedia];
}

function hookDetail(h: LocalHook | undefined, cityName: string): string | null {
  if (!h) return null;
  const place = tidy(h.landmark) ? `${tidy(h.landmark)}, ${tidy(h.placeName) || cityName}` : tidy(h.placeName) || cityName;
  return `${h.kind === 'filmed' ? 'Shot in' : 'Set in'} ${place}`;
}

type NamedRow = Record<string, unknown>;

const SIMPLE: Record<string, { label: string; section: BriefSectionKey; idKey: string; what: string }> = {
  venue: { label: 'Qloo · places', section: 'venues', idKey: 'entityId', what: 'The venue' },
  tag: { label: 'Qloo · tags', section: 'themes', idKey: 'tagId', what: 'Food theme among recommended venues' },
  artist: { label: 'Qloo · artists', section: 'artists', idKey: 'entityId', what: 'The artist' },
  brand: { label: 'Qloo · brands', section: 'brands', idKey: 'entityId', what: 'The brand' },
};

/** The chips one evidence id draws. An id with an unknown prefix draws none. */
export function chipsForId(id: string, bundle: SectionBundle, cityName: string): ChipSpec[] {
  const colon = id.indexOf(':');
  const prefix = colon === -1 ? id : id.slice(0, colon);
  const rest = colon === -1 ? '' : id.slice(colon + 1);

  if (prefix === 'demo') {
    const bucket = (AGE_BUCKETS as readonly string[]).includes(rest) ? AGE_LABELS[rest as AgeBucket] : rest === 'male' || rest === 'female' ? rest : null;
    const detail = bucket ? `Audience skews ${bucket} above average (relative, not a share of people)` : null;
    return [{ label: 'Qloo · demographics', detail }];
  }

  if (prefix === 'heat') {
    const i = Number.parseInt(rest, 10);
    const hood = Number.isInteger(i) && i >= 0 ? topNeighbourhoods(arrayOf<HeatCell>(bundle.where), 3)[i] : undefined;
    return [{ label: 'Qloo · heatmap', detail: hood ? `Heatmap affinity near ${hood.name}` : null }];
  }

  if (prefix === 'hook') {
    // The kind must be one the service writes, and the hook section must hold a
    // record of it: the source of that record decides the label. Anything else
    // cannot be checked, so it is not dressed up as Wikipedia or Wikidata
    // evidence; an unknown kind draws nothing (like an unknown prefix).
    if (rest !== 'filmed' && rest !== 'set') return [];
    const hook = arrayOf<LocalHook>(bundle.hook).find((h) => h.kind === rest);
    if (!hook) return [{ label: AGENT_SUGGESTION, detail: null }];
    const detail = hookDetail(hook, cityName);
    return hookChips({ kind: rest, source: hook.source }, cityName).map((label) => ({ label, detail }));
  }

  const simple = SIMPLE[prefix];
  if (simple) {
    const row = arrayOf<Venue | TagAffinity | NamedEntity>(bundle[simple.section]).find(
      (r) => idPart((r as unknown as NamedRow)[simple.idKey]) === rest,
    );
    const name = row ? tidy((row as unknown as NamedRow).name) : '';
    return name ? [{ label: simple.label, detail: `${simple.what}: ${name}` }] : [{ label: AGENT_SUGGESTION, detail: null }];
  }

  return [];
}

/**
 * The chips for one clause: one per distinct label, in first-cited order, with
 * the details of every id behind a label merged. No ids is the model's own
 * suggestion. A clause whose ids are all unrecognised is too: nothing in the
 * bundle backs it, and "Agent suggestion" is the honest label for that.
 */
export function chipsForEvidence(evidence: string[], bundle: SectionBundle, cityName: string): ChipSpec[] {
  const byLabel = new Map<string, string[]>();
  for (const id of evidence) {
    for (const chip of chipsForId(id, bundle, cityName)) {
      const details = byLabel.get(chip.label) ?? [];
      if (chip.detail && !details.includes(chip.detail)) details.push(chip.detail);
      byLabel.set(chip.label, details);
    }
  }
  if (byLabel.size === 0) return [{ label: AGENT_SUGGESTION, detail: null }];
  return [...byLabel].map(([label, details]) => ({ label, detail: details.length ? details.join(' · ') : null }));
}
