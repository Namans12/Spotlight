/** Offline audit of a completed live run. No network, names or source payloads
 * on stdout. From services/pulse: npx tsx spike/evaluationReport.ts --run=...
 * A matching plan is not a measured business outcome or usefulness score.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Campaign } from '../../../shared/types/pulse.js';
import type { EvidenceFact } from '../src/campaign.js';

interface Result {caseId:string;repeat:number;arm:string;status:string;calls:number;ms?:number;campaign?:Campaign}
const run=process.argv.find(arg=>arg.startsWith('--run='))?.slice(6);
if(!run||!/^[a-z0-9-]{1,60}$/.test(run)) throw new Error('Pass --run=<saved-run-name>.');
const dir=fileURLToPath(new URL(`./out/${run}/`,import.meta.url));
const read=<T>(path:string):T=>JSON.parse(readFileSync(dir+'/'+path,'utf8')) as T;
const manifest=read<{cases:{id:string}[];repeats:number;promptHash:string}>('manifest.json');
const results=read<Result[]>('results.json');
const keys=results.map(r=>`${r.caseId}:${r.repeat}:${r.arm}`);
if(new Set(keys).size!==keys.length) throw new Error('Duplicate evaluation outcomes.');
if(results.length!==manifest.cases.length*manifest.repeats*2) throw new Error('Run is incomplete.');
const median=(numbers:number[])=>{
  const n=[...numbers].sort((a,b)=>a-b),mid=Math.floor(n.length/2);
  return n.length===0?null:n.length%2?n[mid]:(n[mid-1]+n[mid])/2;
};
let citedClauses=0,invalidReferences=0,nonVerbatimContexts=0,baselineCitations=0;
for(const r of results.filter(r=>r.status==='ok')) {
  const source=read<{bundle:EvidenceFact[]}>(`${r.caseId}-source.json`);
  const facts=new Map(source.bundle.map(fact=>[fact.id,fact.fact]));
  for(const clause of r.campaign!.ideas.flatMap(idea=>idea.clauses)) {
    if(!clause.evidence.length) continue;
    citedClauses++;
    if(r.arm==='baseline') baselineCitations++;
    for(const id of clause.evidence) if(!facts.has(id)) invalidReferences++;
    if(clause.evidence.length!==1||clause.text!==facts.get(clause.evidence[0])) nonVerbatimContexts++;
  }
}
let pairedSuccesses=0,identicalPlanPairs=0,matchingPlans=0;
for(const q of results.filter(r=>r.arm==='qloo'&&r.status==='ok')) {
  const b=results.find(r=>r.caseId===q.caseId&&r.repeat===q.repeat&&r.arm==='baseline'&&r.status==='ok');
  if(!b) continue;
  pairedSuccesses++;
  const count=q.campaign!.ideas.filter(idea=>b.campaign!.ideas.some(other=>other.kind===idea.kind&&other.title===idea.title)).length;
  matchingPlans+=count;if(count===3) identicalPlanPairs++;
}
const currentHash=createHash('sha256').update(readFileSync(new URL('../src/campaign.ts',import.meta.url))).digest('hex');
const report={run,outcomes:results.length,promptMatchesCurrentCode:currentHash===manifest.promptHash,
  arms:['qloo','baseline'].map(arm=>{
    const rows=results.filter(r=>r.arm===arm),ok=rows.filter(r=>r.status==='ok');
    return{arm,ok:ok.length,fallback:rows.filter(r=>r.status==='fallback').length,error:rows.filter(r=>r.status==='error').length,abstained:rows.filter(r=>r.status==='abstained').length,calls:rows.reduce((n,r)=>n+r.calls,0),successfulWriterMedianMs:median(ok.map(r=>r.ms!)),successfulWriterMaxMs:Math.max(0,...ok.map(r=>r.ms!))};
  }),audit:{citedClauses,invalidReferences,nonVerbatimContexts,baselineCitations},
  planComparison:{pairedSuccesses,matchingPlans,totalPlans:pairedSuccesses*3,identicalPlanPairs,note:'Both arms use the same bounded action vocabulary; plan identity/difference is not proof of business usefulness.'}};
console.log(JSON.stringify(report,null,2));
if(invalidReferences||nonVerbatimContexts||baselineCitations) process.exitCode=1;
