import { pool } from "@workspace/db";
import { DeadlineRulesService } from "./service";
// Existing web-process worker pattern: no new Render service.
export function createDeadlineWorker(onError:(error:unknown)=>void) {
  const service=new DeadlineRulesService(pool,process.env.DEADLINE_EMAIL_ENABLED==="true");
  let timer:ReturnType<typeof setInterval>|null=null;
  let running:Promise<unknown>|null=null;
  const tick=()=>{
    if(running)return;
    running=service.evaluate().then(()=>service.dispatchEmailHooks()).catch(onError).finally(()=>{running=null;});
  };
  return {
    start(){if(timer)return;tick();timer=setInterval(tick,15*60*1000);timer.unref();},
    async close(){if(timer)clearInterval(timer);timer=null;await running;},
  };
}
