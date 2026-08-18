import type {
  ManagerAssistantContextBundle,
  ManagerAssistantContextKind,
  ManagerAssistantContextRef,
} from "./manager-assistant-types";

export type ManagerAssistantCachedSnapshot = {
  key: string;
  legId: string;
  contextKind: ManagerAssistantContextKind;
  contextRecordId: string;
  savedAt: string;
  context: ManagerAssistantContextBundle;
};

export function managerAssistantCacheKey(legId:string,context:Pick<ManagerAssistantContextRef,"kind"|"recordId">){return `${legId}:${context.kind}:${context.recordId}`;}

export function pruneManagerAssistantSnapshots(rows:readonly ManagerAssistantCachedSnapshot[],options:{now?:Date;maxEntries?:number;maxAgeDays?:number}={}){
  const now=options.now??new Date(),maxEntries=options.maxEntries??20,maxAgeDays=options.maxAgeDays??30;
  const cutoff=now.getTime()-maxAgeDays*86400000;
  return [...rows].filter(row=>new Date(row.savedAt).getTime()>=cutoff).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).slice(0,maxEntries);
}

const DB_NAME="adventure-zone-manager-assistant";const STORE="context-snapshots";
function openDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>{const database=request.result;if(!database.objectStoreNames.contains(STORE))database.createObjectStore(STORE,{keyPath:"key"});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function all():Promise<ManagerAssistantCachedSnapshot[]>{if(typeof indexedDB==="undefined")return[];const database=await openDb();return new Promise((resolve,reject)=>{const tx=database.transaction(STORE,"readonly"),request=tx.objectStore(STORE).getAll();request.onsuccess=()=>resolve(request.result as ManagerAssistantCachedSnapshot[]);request.onerror=()=>reject(request.error);tx.oncomplete=()=>database.close();});}
async function remove(key:string){if(typeof indexedDB==="undefined")return;const database=await openDb();return new Promise<void>((resolve,reject)=>{const tx=database.transaction(STORE,"readwrite"),request=tx.objectStore(STORE).delete(key);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);tx.oncomplete=()=>database.close();});}

export async function saveManagerAssistantContext(input:{legId:string;contextRef:ManagerAssistantContextRef;context:ManagerAssistantContextBundle}){
  if(typeof indexedDB==="undefined")return;
  const row:ManagerAssistantCachedSnapshot={key:managerAssistantCacheKey(input.legId,input.contextRef),legId:input.legId,contextKind:input.contextRef.kind,contextRecordId:input.contextRef.recordId,savedAt:new Date().toISOString(),context:input.context};
  const database=await openDb();await new Promise<void>((resolve,reject)=>{const tx=database.transaction(STORE,"readwrite"),request=tx.objectStore(STORE).put(row);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);tx.oncomplete=()=>database.close();});
  const rows=await all(),keep=pruneManagerAssistantSnapshots(rows.filter(item=>item.legId===input.legId)),keepKeys=new Set(keep.map(item=>item.key));
  await Promise.all(rows.filter(item=>item.legId===input.legId&&!keepKeys.has(item.key)).map(item=>remove(item.key)));
}

export async function getManagerAssistantContext(legId:string,contextRef:ManagerAssistantContextRef){
  if(typeof indexedDB==="undefined")return null;const database=await openDb();return new Promise<ManagerAssistantCachedSnapshot|null>((resolve,reject)=>{const tx=database.transaction(STORE,"readonly"),request=tx.objectStore(STORE).get(managerAssistantCacheKey(legId,contextRef));request.onsuccess=()=>{const row=request.result as ManagerAssistantCachedSnapshot|undefined;resolve(row?(pruneManagerAssistantSnapshots([row])[0]??null):null);};request.onerror=()=>reject(request.error);tx.oncomplete=()=>database.close();});
}

export async function clearManagerAssistantCache(legId:string){const rows=await all();await Promise.all(rows.filter(row=>row.legId===legId).map(row=>remove(row.key)));}
