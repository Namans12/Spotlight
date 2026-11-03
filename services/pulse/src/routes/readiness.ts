import type { Handler } from '../http/router.js';
import { json } from './params.js';

/** Database/schema readiness, separate from process liveness. No paid provider
 * calls. Concurrent probes share a check so an outage cannot fill the pool. */
export function readinessHandler(check: () => PromiseLike<unknown>, timeoutMs = 1500): Handler {
  let pending: Promise<boolean> | null = null;
  return async (_req,res) => {
    pending ??= Promise.resolve().then(check).then(() => true, () => false).finally(() => {pending=null;});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready=await Promise.race([pending,new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);
      json(res,ready?200:503,{ready});
    } finally {clearTimeout(timer);}
  };
}
