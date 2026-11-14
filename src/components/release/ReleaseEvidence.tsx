import type { ReleaseEvidenceDTO } from '../../../shared/types/release';

import { evidenceDate, providerDetails } from './evidence-format';

export function ReleaseEvidence({ evidence, providers }: { evidence: ReleaseEvidenceDTO; providers: string[] }) {
  return <details className="mt-1 text-[10px] text-muted-foreground leading-snug space-y-0.5"><summary className="cursor-pointer">Release details</summary>
    <p>{providerDetails(providers, evidence.provider_types)}</p>
    <p>Source: {evidence.date_source === 'tmdb_regional_digital' ? 'TMDB' : 'unknown'}{providers.length && evidence.provider_source === 'tmdb_regional_availability' ? ' / JustWatch' : ''} · Region: {evidence.region || 'unknown'} · {evidenceDate(evidence.observed_at)}</p>
    <p>{evidence.date_source === 'tmdb_regional_digital' ? 'Date reported by TMDB; availability may change.' : 'Release date unverified; availability may change.'}</p>
  </details>;
}
