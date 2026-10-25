import { describe,expect,it,vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readinessHandler } from './readiness.js';

function response(){
  const out={status:0,body:'',writeHead(status:number){out.status=status;},end(body:string){out.body=body;}};
  return {out,res:out as unknown as ServerResponse};
}
const req={} as IncomingMessage;
const url=new URL('http://local/readyz');
describe('readiness',()=>{
  it('returns 503 for DB failure without exposing the cause and recovers on the next probe',async()=>{
    const check=vi.fn().mockRejectedValueOnce(new Error('private connection details')).mockResolvedValueOnce(undefined);
    const handler=readinessHandler(check),failed=response(),ok=response();
    await handler(req,failed.res,url);await handler(req,ok.res,url);
    expect(failed.out).toMatchObject({status:503,body:'{"ready":false}'});
    expect(ok.out).toMatchObject({status:200,body:'{"ready":true}'});
  });
  it('bounds the response and shares a still-pending DB check',async()=>{
    const check=vi.fn(()=>new Promise(()=>{}));
    const handler=readinessHandler(check,5),first=response(),second=response();
    await Promise.all([handler(req,first.res,url),handler(req,second.res,url)]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(first.out.status).toBe(503);expect(second.out.status).toBe(503);
  });
});
