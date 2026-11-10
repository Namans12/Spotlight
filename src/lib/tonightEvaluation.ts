/** Ranking metrics for independently labelled titles. Keys include media type. */
export function rankingMetrics(ranked: string[], relevant: string[], cutoff = 3) {
  const unique = [...new Set(ranked)];
  const labels = new Set(relevant);
  const first = unique.findIndex(key => labels.has(key));
  const displayed = unique.slice(0, Math.max(0, cutoff));
  const hits = displayed.filter(key => labels.has(key)).length;
  return {
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    precisionAtCutoff: displayed.length ? hits / displayed.length : 0,
    relevantCoverage: labels.size ? unique.filter(key => labels.has(key)).length / labels.size : null,
    eligibleCount: unique.length,
  };
}

/** Paired comparisons must use the same eligible titles for both rankers. */
export function compareRankings(baseline: string[], updated: string[], relevant: string[]) {
  const before = new Set(baseline), after = new Set(updated);
  if (before.size !== baseline.length || after.size !== updated.length || before.size !== after.size ||
      [...before].some(key => !after.has(key))) throw new Error('Rankings must contain the same unique eligible titles');
  return { baseline: rankingMetrics(baseline, relevant), updated: rankingMetrics(updated, relevant) };
}
