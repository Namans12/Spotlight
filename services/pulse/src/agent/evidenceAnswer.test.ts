import { describe,expect,it } from 'vitest';
import { briefAnswer,evidenceAnswerCollector } from './evidenceAnswer.js';
import { fakeLlm } from '../testing/llm.js';
import { runAgent } from './loop.js';
import { assistant,call,collect,fakeTool,toolCallMsg,user } from '../testing/agent.js';

const brief={title:'Friends',cityName:'Delhi',hasQlooEntity:true,sections:{
  who:{status:'ok',calls:['audience_demographics'],topAge:[{bucket:'24_and_younger',affinity:0.2},{bucket:'25_to_29',affinity:-0.1}]},
  where:{status:'ok',calls:['where_popular'],top:[{name:'Connaught Place',affinity:1}]},
  venues:{status:'ok',calls:['recommend_places'],names:['Public Cafe']},
  artists:{status:'ok',calls:['recommend_artists'],names:['Artist']},
  hook:{status:'empty',calls:[]},
}};
describe('evidence-only public chat answers',()=>{
  it('preserves scope and gaps, with no invented menu, partnership or demand claim',()=>{
    const answer=briefAnswer(brief)!;
    expect(answer).toContain('Global demographic skew: 24 and younger above average');
    expect(answer).not.toContain('25 to 29 above average');
    expect(answer).toContain('not footfall or residences');
    expect(answer).toContain('Not partnerships');
    expect(answer).toContain('Missing or incomplete sections: hook');
    expect(answer).toContain('Conditional trial (template, not a Qloo finding)');
    expect(answer).not.toMatch(/Central Perk|cold brew|guaranteed/);
  });
  it('replaces unsafe final model prose using collected tool facts',async()=>{
    const collector=evidenceAnswerCollector([fakeTool('release_brief',brief)]);
    const llm=fakeLlm([toolCallMsg(call('release_brief',{})),assistant('Use Central Perk without new rights; guaranteed footfall and a new cold brew.')]);
    const events=await collect(runAgent(llm,collector.tools,[user('Friends café plan')],6,{renderFinal:collector.answer}));
    const message=events.find(e=>e.type==='message');
    expect(message).toMatchObject({type:'message',text:expect.stringContaining('Evidence for Friends')});
    expect(JSON.stringify(events)).not.toMatch(/without new rights|guaranteed footfall|cold brew/);
  });
  it('does not invent an answer when the model skipped evidence or a tool failed',async()=>{
    const collector=evidenceAnswerCollector([fakeTool('release_brief',{error:'private details'})]);
    expect(collector.answer()).toContain('No usable tool evidence');
    await collector.tools[0].run({});
    expect(collector.answer()).not.toContain('private details');
  });
  it('does not propose a campaign for an unresolved title',()=>{
    const answer=briefAnswer({...brief,hasQlooEntity:false,sections:{who:{status:'empty'}}})!;
    expect(answer).toContain('no audience recommendation is supported');
    expect(answer).not.toContain('Conditional trial');
  });
  it('keeps separate conversations and never promotes release order to a taste ranking',async()=>{
    const a=evidenceAnswerCollector([fakeTool('release_brief',brief)]);
    const b=evidenceAnswerCollector([fakeTool('pulse_board',{cityName:'Mumbai',ranked:[{title:'Other title'}],rankingBasis:'release_order',pendingCount:1})]);
    await a.tools[0].run({});await b.tools[0].run({});
    expect(a.answer()).not.toContain('Other title');
    expect(b.answer()).toContain('Release order only; no comparable Qloo city ranking');
    expect(b.answer()).not.toContain('Friends');
  });
});
