import {expect,it} from 'vitest';
import {runMailboxTurn} from './google-mailbox-sync-loop';
it('processes at most 25 jobs serially and yields remaining work for another turn',async()=>{
 let remaining=4000,processed=0,active=0,maxActive=0,released=false;
 const account={checkpoint:{phase:'ready'}};
 const repo:any={claimAccount:async()=>account,current:async()=>account,renew:async()=>true,claimThreads:async()=>remaining-->0?[{}]:[],release:async()=>{released=true;}};
 const result=await runMailboxTurn({repo,connectionId:'c',ingest:async()=>{},process:async()=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();processed++;active--;},historyDue:false,now:()=>0});
 expect(result.processed).toBe(25);expect(processed).toBe(25);expect(maxActive).toBe(1);expect(released).toBe(true);
});
it('does not fetch or process anything when another worker owns the account',async()=>{
 const result=await runMailboxTurn({repo:{claimAccount:async()=>null} as any,connectionId:'c',ingest:async()=>{throw Error('unexpected fetch');},process:async()=>{throw Error('unexpected work');},historyDue:true});
 expect(result.processed).toBe(0);
});
