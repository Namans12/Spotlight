/** Paired live evaluation, never used by public routes.
 * From services/pulse: DATABASE_URL=... npx tsx --env-file=.env spike/evaluate.ts --live
 * Uses production recipes/writer/pacer, bypasses campaign caches, and stores raw
 * evidence only under ignored spike/out. No human/business value auto-score.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { BriefSectionKey, BusinessType, EvidenceSection } from '../../../shared/types/pulse.js';
import { tmdbDetail } from '../../../lib/tmdbProxy.js';
import { streamBrief, type TitleSummary } from '../src/brief.js';
import { buildBundle, campaignQualityIssues, draftCampaign, draftWithoutQloo, isFallback, type DraftContext, type EvidenceFact } from '../src/campaign.js';
import { getCity } from '../src/cities.js';
import { loadConfig } from '../src/config.js';
import { createGroqClient, type LlmClient } from '../src/llm/client.js';
import { createQlooClient } from '../src/qloo/client.js';
import { resolveTitle } from '../src/resolve.js';
import { createTitleLookup } from '../src/titleHeader.js';

export const CASES = [
  {id:'tv-delhi-cafe',tmdbId:250923,mediaType:'tv',city:'delhi',type:'cafe'},
  {id:'tv-mumbai-d2c',tmdbId:250923,mediaType:'tv',city:'mumbai',type:'d2c_food'},
  {id:'franchise-delhi-d2c',tmdbId:117736,mediaType:'tv',city:'delhi',type:'d2c_food'},
  {id:'franchise-mumbai-cafe',tmdbId:117736,mediaType:'tv',city:'mumbai',type:'cafe'},
  {id:'movie-delhi-cafe',tmdbId:1578079,mediaType:'movie',city:'delhi',type:'cafe'},
  {id:'movie-mumbai-d2c',tmdbId:1578079,mediaType:'movie',city:'mumbai',type:'d2c_food'},
  {id:'unresolved-delhi-cafe',tmdbId:292741,mediaType:'tv',city:'delhi',type:'cafe'},
  {id:'unresolved-mumbai-d2c',tmdbId:292741,mediaType:'tv',city:'mumbai',type:'d2c_food'},
  {id:'friends-nbc-delhi',tmdbId:1668,mediaType:'tv',city:'delhi',type:'cafe',brief:'Nothing Before Coffee for coffee lovers who watch Friends. Coffee is the only confirmed product category. Specific menu, budget, owned channels, space and media rights are unconfirmed. Delhi is an evaluation assumption, not a confirmed store location.'},
  {id:'friends-nbc-mumbai',tmdbId:1668,mediaType:'tv',city:'mumbai',type:'cafe',brief:'Nothing Before Coffee for coffee lovers who watch Friends. Coffee is the only confirmed product category. Specific menu, budget, owned channels, space and media rights are unconfirmed. Mumbai is an evaluation assumption, not a confirmed store location.'},
] as const;

if (!process.argv.includes('--live')) throw new Error('Pass --live to spend Qloo/Groq quota. See docs/submission/evaluation-plan.md.');
const config=loadConfig(process.env);
if(config.qlooFixtures||!config.groqApiKey) throw new Error('Live Qloo and a configured writer are required.');
const requested=process.argv.find(arg=>arg.startsWith('--cases='))?.slice(8).split(',');
if(requested?.some(id=>!CASES.some(c=>c.id===id))) throw new Error('Unknown evaluation case.');
const cases=requested?CASES.filter(c=>requested.includes(c.id)):CASES;
const sql=postgres(config.databaseUrl,{max:3});
const qloo=createQlooClient(config);
const llm=createGroqClient(config);
const header=createTitleLookup(sql,(type,id)=>tmdbDetail(type,id));
const runName=process.argv.find(arg=>arg.startsWith('--run='))?.slice(6)??'evaluation-oct26-v2';
if(!/^[a-z0-9-]{1,60}$/.test(runName)) throw new Error('Use a short lowercase run name.');
const out=fileURLToPath(new URL(`./out/${runName}/`,import.meta.url));
if(existsSync(out+'/manifest.json')) throw new Error('This run already exists; use --run=new-name to preserve prior results.');
mkdirSync(out,{recursive:true,mode:0o700});
const promptHash=createHash('sha256').update(readFileSync(new URL('../src/campaign.ts',import.meta.url))).digest('hex');
const records: Record<string,unknown>[]=[];
const manifest={startedAt:new Date().toISOString(),model:config.groqModel,reasoningEffort:config.groqReasoningEffort,promptHash,repeats:2,cases,temperature:0.4,composition:'same bounded trial templates in both arms; model selects context and plan',cache:'campaign caches bypassed; production evidence cache allowed',review:'internal exploratory paired evaluation; no blinded customer study'};
writeFileSync(out+'/manifest.json',JSON.stringify(manifest,null,2),{mode:0o600});
function save(){writeFileSync(out+'/results.json',JSON.stringify(records,null,2),{mode:0o600});}

try {
  for (const [index,c] of cases.entries()) {
    const city=getCity(c.city)!;
    const key={tmdbId:c.tmdbId,mediaType:c.mediaType};
    const sections:Partial<Record<BriefSectionKey,EvidenceSection<unknown>>>={};
    let title:TitleSummary|null=null;
    let bundle:EvidenceFact[]=[];
    let sourceComplete=false;
    const sourceStarted=Date.now();
    try {
      for await(const event of streamBrief({sql,qloo,resolve:key=>resolveTitle(sql,qloo,key),header,draftCampaign:async()=>({status:'empty',data:null,provenance:[],note:'Writer disabled during source capture.'})},
        {city,businessType:c.type,key,signal:AbortSignal.timeout(120_000)})) {
        if(event.type==='header') title=event.header;
        if(event.type==='section'&&event.key!=='campaign') sections[event.key]=event.section;
        if(event.type==='done') sourceComplete=true;
      }
      if(title) bundle=buildBundle(sections,city.name,title.title);
    } catch { /* Record the source failure, never fabricate a bundle. */ }
    const context:DraftContext={title:title?.title??'Unknown release',cityName:city.name,businessType:c.type as BusinessType,releaseDate:title?.releaseDate??null,...('brief' in c?{businessBrief:c.brief}:{})};
    writeFileSync(out+`/${c.id}-source.json`,JSON.stringify({context,sourceComplete,sourceMs:Date.now()-sourceStarted,sections,bundle},null,2),{mode:0o600});
    for(let repeat=0;repeat<2;repeat++) {
      // Counterbalance time/order effects; both paths share all practical rules.
      const arms=(index+repeat)%2===0?['qloo','baseline']:['baseline','qloo'];
      for(const arm of arms) {
        const start=Date.now();let calls=0;const failures:string[]=[];
        const observed:LlmClient={chat:async(...args)=>{
          calls++;
          const reply=await llm.chat(...args);
          writeFileSync(out+`/${c.id}-${repeat}-${arm}-attempt-${calls}.json`,JSON.stringify(reply,null,2),{mode:0o600});
          return reply;
        }};
        const base={caseId:c.id,repeat,arm,evidenceFacts:bundle.length,sourceComplete};
        if(!title||!sourceComplete||(arm==='qloo'&&bundle.length===0)) {
          const record={...base,status:'abstained',reason:!title||!sourceComplete?'source_unavailable':'no_evidence',calls:0};
          records.push(record);save();console.log(JSON.stringify(record));continue;
        }
        try {
          const signal=AbortSignal.timeout(60_000);
          const campaign=arm==='qloo'?await draftCampaign(observed,bundle,context,(_context,error)=>failures.push(String((error as {kind?:string}).kind??'writer_error')),signal):await draftWithoutQloo(observed,context,(_context,error)=>failures.push(String((error as {kind?:string}).kind??'writer_error')),signal);
          const clauses=campaign.ideas.flatMap(i=>i.clauses);
          const ids=new Set(bundle.map(f=>f.id));
          const report={...base,status:isFallback(campaign)?'fallback':'ok',ms:Date.now()-start,calls,clauses:clauses.length,citedClauses:clauses.filter(c=>c.evidence.length).length,invalidIds:clauses.flatMap(c=>c.evidence).filter(id=>!ids.has(id)).length,mechanicalQualityIssues:campaignQualityIssues(campaign),failures};
          records.push({...report,campaign});save();console.log(JSON.stringify(report));
        } catch(error) {
          const report={...base,status:'error',ms:Date.now()-start,calls,errorKind:String((error as {kind?:string}).kind??'unknown'),failures};
          records.push(report);save();console.log(JSON.stringify(report));
        }
      }
    }
  }
} finally {save();await qloo.close?.();await sql.end();}
