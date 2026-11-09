import type { ReleaseEvidenceDTO } from '../../../shared/types/release';

export function evidenceDate(value?: string | null): string {
  if (!value) return 'Last checked: unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Last checked: unknown' : `Checked ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function providerDetails(providers: string[], types?: Record<string, string[]> | null): string {
  if (!providers.length) return 'Availability unknown';
  return providers.map(name => `${name} (${types?.[name]?.length ? types[name].join(', ') : 'type unknown'})`).join(' · ');
}

export function ReleaseEvidence({ evidence, providers }: { evidence: ReleaseEvidenceDTO; providers: string[] }) {
  return <div className="mt-1 text-[10px] text-muted-foreground leading-snug space-y-0.5">
    <p>{providerDetails(providers, evidence.provider_types)}</p>
    <p>Source: {evidence.date_source === 'tmdb_regional_digital' ? 'TMDB' : 'unknown'}{providers.length && evidence.provider_source === 'tmdb_regional_availability' ? ' / JustWatch' : ''} · Region: {evidence.region || 'unknown'} · {evidenceDate(evidence.observed_at)}</p>
    <p>{evidence.date_source === 'tmdb_regional_digital' ? 'Date reported by TMDB; availability may change.' : 'Release date unverified; availability may change.'}</p>
  </div>;
}
