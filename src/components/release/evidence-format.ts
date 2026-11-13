export function evidenceDate(value?: string | null): string {
  if (!value) return 'Last checked: unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Last checked: unknown' : `Checked ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function providerDetails(providers: string[], types?: Record<string, string[]> | null): string {
  if (!providers.length) return 'Availability unknown';
  return providers.map(name => `${name} (${types?.[name]?.length ? types[name].join(', ') : 'type unknown'})`).join(' · ');
}

