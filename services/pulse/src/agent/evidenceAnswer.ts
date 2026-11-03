// Public chat is a tool-driven evidence browser. The model chooses lookups;
// final advice is composed from tool data, never its unchecked prose.
import { cleanText, composeCampaign } from '../campaign.js';
import type { AgentTool } from './tools.js';

const rec=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const rows=(v:unknown):Record<string,unknown>[]=>Array.isArray(v)?v.map(rec):[];
const names=(v:unknown)=>rows(v).map(r=>cleanText(r.name??r.title,50)).filter(Boolean).slice(0,2);
const list=(v:unknown)=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string').map(s=>cleanText(s,50)).slice(0,2):[];
const usable=(s:Record<string,unknown>)=>s.status==='ok'||s.status==='partial';
const calls=(s:Record<string,unknown>)=>list(s.calls).join(', ')||'source unavailable';

export function briefAnswer(raw:unknown):string|null {
  const r=rec(raw),sections=rec(r.sections);
  if(typeof r.title!=='string'||!r.sections) return null;
  const title=cleanText(r.title,70),city=cleanText(r.cityName??r.city,40);
  const out=[`Evidence for ${title}${city?` in ${city}`:''} (cached data may be days old).`];
  const who=rec(sections.who),where=rec(sections.where),venues=rec(sections.venues),artists=rec(sections.artists);
  if(usable(who)) {
    const age=rows(who.topAge).filter(x=>typeof x.affinity==='number'&&x.affinity>0).slice(0,2).map(x=>cleanText(x.bucket,30).replaceAll('_',' '));
    out.push(`Global demographic skew${age.length?`: ${age.join(', ')} above average`: ' available'} (${calls(who)}). Not a city profile or population share.`);
  }
  const areas=names(where.top);
  if(usable(where)&&areas.length) out.push(`${city} heatmap affinity near ${areas.join(', ')} (${calls(where)}); not footfall or residences.`);
  const places=list(venues.names);
  if(usable(venues)&&places.length) out.push(`City-filtered venue associations: ${places.join(', ')} (${calls(venues)}). Not partnerships or proof of local customers.`);
  const acts=list(artists.names);
  if(usable(artists)&&acts.length) out.push(`Global artist associations: ${acts.join(', ')} (${calls(artists)}).`);
  const gaps=Object.entries(sections).filter(([k,s])=>k!=='campaign'&&!usable(rec(s))).map(([k])=>cleanText(k,20));
  if(gaps.length) out.push(`Missing or incomplete sections: ${gaps.join(', ')}.`);
  if(r.hasQlooEntity===false) out.push('Qloo has no resolved entity here; no audience recommendation is supported.');
  else if(out.length===1) out.push('No usable audience evidence was returned; open the brief for section status.');
  else {
    const plan=composeCampaign({groundedBy:'none',ideas:[{kind:'special',title:'product_spotlight',timing:'',clauses:[]}]},[]);
    out.push(`Conditional trial (template, not a Qloo finding): ${plan.ideas[0].clauses[0].text}`);
  }
  return out.join('\n\n');
}

function boardAnswer(raw:unknown):string|null {
  const r=rec(raw);
  if(!Array.isArray(r.ranked)) return null;
  const titles=names(r.ranked),city=cleanText(r.cityName??r.city,40);
  const order=r.rankingBasis==='qloo_shortlist'?'Qloo order within separate returned film/TV shortlists':'Release order only; no comparable Qloo city ranking';
  return `${city?city+': ':''}${order}. ${titles.length?`Titles shown: ${titles.join(', ')}.`:'No titles ready.'} ${typeof r.pendingCount==='number'?`${r.pendingCount} still loading. `:''}Open a release brief to inspect evidence before choosing a theme. Ranks do not forecast demand or attendance.`;
}

/** Per-request collector; closures never share evidence across chats. */
export function evidenceAnswerCollector(tools:AgentTool[]) {
  const briefs:string[]=[],boards:string[]=[],other:string[]=[];
  return {
    tools:tools.map(tool=>({...tool,async run(args:Record<string,unknown>,ctx?:{signal:AbortSignal}){
      const raw=await tool.run(args,ctx);
      if(ctx?.signal.aborted||rec(raw).error) return raw;
      const name=tool.spec.function.name;
      if(name==='release_brief') {const answer=briefAnswer(raw);if(answer)briefs.push(answer);}
      else if(name==='pulse_board') {const answer=boardAnswer(raw);if(answer)boards.push(answer);}
      else {
        const r=rec(raw),found=Array.isArray(r.results)?r.results:Array.isArray(r.titles)?r.titles:null;
        if(found&&(r.status===undefined||r.status==='ok'||r.status==='partial'||r.status==='empty')) {
          const selected=names(found);
          other.push(`${cleanText(name,64)} returned ${found.length} results${selected.length?`: ${selected.join(', ')}`:''}. These are source associations, not partnerships or demand forecasts. Open a city-specific brief for scope and limitations.`);
        }
      }
      return raw;
    }})),
    answer:()=>[...new Set(briefs.length?briefs:boards.length?boards:other)].slice(-2).join('\n\n')||'No usable tool evidence was returned. Ask for one title, a city and café or food brand so I can retrieve a brief.',
  };
}
