import { pool } from "@workspace/db";
import { AgentTaxService } from "./service";
import { createTaxStorage } from "./storage";
let service:AgentTaxService|undefined;
export function getAgentTaxService() {
  if(!service) {
    const config=createTaxStorage();
    service=new AgentTaxService(pool,config.storage,config.available);
  }
  return service;
}
let timer:ReturnType<typeof setInterval>|undefined;
export function startAgentTaxCleanup() {
  if(timer) return;
  const clean=()=>{try {void getAgentTaxService().cleanup();} catch {/* missing storage leaves durable queue for retry */}};
  clean();
  timer=setInterval(clean,60_000);
  timer.unref();
}
