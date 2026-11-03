/** Live fixed-slate ranking check, summaries only (no names or API payloads).
 * cd services/pulse && npx tsx --env-file=.env spike/rank.ts --city=delhi --warm
 * Uses the configured database. --warm resolves candidates and fills private
 * Qloo caches, spending event quota; omit it for a cache-only board check.
 */
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';
import { createQlooClient } from '../src/qloo/client.js';
import { resolveTitle } from '../src/resolve.js';
import { warmBoardRanks, warmCity } from '../src/warm.js';
import { listCandidates, buildBoard } from '../src/board.js';
import { getCity } from '../src/cities.js';

const slug = process.argv.find(arg => arg.startsWith('--city='))?.slice(7) ?? 'delhi';
const city = getCity(slug);
if (!city) throw new Error('Unknown city.');
const config = loadConfig(process.env);
if (config.qlooFixtures) throw new Error('This diagnostic requires live Qloo, not fixtures.');
const sql = postgres(config.databaseUrl, { max: 3 });
const qloo = createQlooClient(config);
const report = (context: string) => console.error(JSON.stringify({ failed: context }));
try {
  const candidates = await listCandidates(sql, city, new Date());
  console.log(JSON.stringify({ city: slug, candidates: candidates.length,
    films: candidates.filter(c => c.card.mediaType === 'movie').length,
    tv: candidates.filter(c => c.card.mediaType === 'tv').length,
    theatrical: candidates.filter(c => c.card.kind === 'theatrical').length }));
  if (process.argv.includes('--warm')) {
    const result = await warmCity({ sql, qloo, resolve: key => resolveTitle(sql, qloo, key), onError: report }, city, 'cafe');
    console.log(JSON.stringify({ city: slug, warm: result }));
  } else if(process.argv.includes('--rank-only')) {
    await warmBoardRanks({sql,qloo,resolve:key=>resolveTitle(sql,qloo,key),onError:report},city,candidates);
  }
  const board = await buildBoard({ sql, enqueueWarm: () => {} }, city, 'cafe');
  console.log(JSON.stringify({ city: slug, displayed:board.ranked.length,ranked:board.ranked.filter(card=>card.localRank!==undefined).length,coverage:board.rankingCoverage,noSignal: board.noSignal?.length,
    pending: board.pending.length, unresolved: board.unresolved.length,
    rankingBasis: board.rankingBasis, rankingPending: board.rankingPending,
    allScoresNull: board.ranked.every(c => c.score === null),
    ranks: board.ranked.map(c => ({ mediaType: c.mediaType, rank: c.localRank, total: c.rankTotal })),
    theatricalVisible: [...board.ranked, ...board.noSignal ?? []].filter(c => c.kind === 'theatrical').length }));
} finally { await qloo.close?.(); await sql.end(); }
