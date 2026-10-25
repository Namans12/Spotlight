import { describe, expect, it, vi } from 'vitest';
import { fetchBoardRank, rankKey } from './boardRank.js';
import { getCity } from './cities.js';
import { boardSql, newBoardDb } from './testing/boardFakes.js';
import { createFixtureClient } from './qloo/fixtures.js';
const city = getCity('delhi')!;
const now = new Date('2026-10-25T06:00:00Z');
function setup(reply: unknown = { status: 'ok', results: [{ entity_id: 'b' }, { entity_id: 'a' }] }) {
 const db = newBoardDb(); const sql = boardSql(db); const qloo = createFixtureClient();
 qloo.callTool = vi.fn(async () => reply);
 return {db,sql,qloo};
}
describe('fixed-slate board ranks', () => {
 it('fingerprints the entire type-specific slate independent of candidate order', () => {
  expect(rankKey('movie',['b','a'])).toBe(rankKey('movie',['a','b','a']));
  expect(rankKey('movie',['a'])).not.toBe(rankKey('movie',['a','b']));
  expect(rankKey('movie',['a'])).not.toBe(rankKey('tv',['a']));
 });
 it('makes one city-signal query, preserves returned order and caches identical questions', async () => {
  const s=setup();
  const r=await fetchBoardRank(s.sql,s.qloo,city,'movie',['a','b'],now);
  expect(r.data).toEqual(['b','a']);
  expect(s.qloo.callTool).toHaveBeenCalledWith('qloo_rank',{options:['a','b'],option_type:'movie',signal_location:'Delhi'});
  expect(r.provenance[0].limits).toContain('not demand');
  await fetchBoardRank(s.sql,s.qloo,city,'movie',['b','a'],now);
  expect(s.qloo.callTool).toHaveBeenCalledTimes(1);
 });
 it('does not fill missing candidates or compare separate query scores', async () => {
  const s=setup({status:'ok',results:[{entity_id:'b',affinity:0.01}]});
  expect((await fetchBoardRank(s.sql,s.qloo,city,'movie',['a','b'],now)).data).toEqual(['b']);
 });
 it('rejects an out-of-slate result and never caches a malformed or failed rank', async () => {
  const s=setup({status:'ok',results:[{entity_id:'intruder'}]});
  expect((await fetchBoardRank(s.sql,s.qloo,city,'movie',['a'],now)).status).toBe('error');
  expect(s.db.evidence.size).toBe(0);
 });
 it('does not reuse a rank for a changed slate or another city', async () => {
  const s=setup({status:'empty',results:[]});
  await fetchBoardRank(s.sql,s.qloo,city,'movie',['a'],now);
  await fetchBoardRank(s.sql,s.qloo,city,'movie',['a','b'],now);
  await fetchBoardRank(s.sql,s.qloo,getCity('mumbai')!,'movie',['a'],now);
  expect(s.qloo.callTool).toHaveBeenCalledTimes(3);
 });
 it('enforces the public tool limit without splitting into incomparable batches', () => {
  const s=setup();
  expect(()=>fetchBoardRank(s.sql,s.qloo,city,'movie',Array.from({length:11},(_,i)=>String(i)),now)).toThrow('1–10');
  expect(s.qloo.callTool).not.toHaveBeenCalled();
 });
});
