// A fixed slate is ranked in ONE Qloo query per media type. Heatmap values
// from different requests are never compared. The slate fingerprint prevents
// a cached answer for yesterday's candidates being applied to today's board.
import { createHash } from 'node:crypto';
import type { EvidenceSection } from '../../../shared/types/pulse.js';
import type { City } from './cities.js';
import type { BoardSql } from './board.js';
import { getEvidence, peekEvidence } from './evidence.js';
import { mapHarnessResult, type QlooClient } from './qloo/client.js';

export type RankMedia = 'movie' | 'tv';
export const MAX_RANK_OPTIONS = 10;
export const RANK_LIMITS = 'Relative order within this fixed, same-type shortlist and city signal only; not demand, audience size, attendance or a comparison with another query.';
export const rankKey = (type: RankMedia, ids: string[]) => `board-rank-v1:${type}:${createHash('sha256').update(JSON.stringify([...new Set(ids)].sort())).digest('hex')}`;

export function readBoardRank(sql: BoardSql, city: City, type: RankMedia, ids: string[], now: Date) {
  return peekEvidence<string[]>(sql, 'board_rank', rankKey(type, ids), city, now);
}

export function fetchBoardRank(sql: BoardSql, qloo: QlooClient, city: City, type: RankMedia, ids: string[], now: Date): Promise<EvidenceSection<string[]>> {
  const options = [...new Set(ids)].sort();
  if (options.length === 0 || options.length > MAX_RANK_OPTIONS) throw new Error('Board ranking requires 1–10 same-type candidates.');
  return getEvidence(sql, 'board_rank', rankKey(type, options), city, async () => {
    const raw = await qloo.callTool('qloo_rank', { options, option_type: type === 'tv' ? 'tv_show' : 'movie', signal_location: city.qlooLocationQuery });
    const section = mapHarnessResult(raw, 'rank', { option_type: type === 'tv' ? 'tv_show' : 'movie', signal_location: city.qlooLocationQuery, option_count: String(options.length), options: options.join(",") }, (rows) => {
      const wanted = new Set(options.map(id => id.toLowerCase()));
      const seen = new Set<string>();
      const ranked: string[] = [];
      for (const row of rows) {
        const value = row as { entity_id?: unknown; id?: unknown };
        const id = value.entity_id ?? value.id;
        if (typeof id !== 'string' || !wanted.has(id.toLowerCase())) throw new Error('Ranking returned an entity outside the requested slate.');
        if (!seen.has(id.toLowerCase())) { ranked.push(options.find(option => option.toLowerCase() === id.toLowerCase())!); seen.add(id.toLowerCase()); }
      }
      return ranked;
    });
    return { ...section, provenance: section.provenance.map(p => ({ ...p, limits: RANK_LIMITS })) };
  }, now);
}
