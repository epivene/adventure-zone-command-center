export type ProfileHistoryItem = {id:string;kind:string;body:string;occurredAt:Date;href?:string};
export function mergeProfileHistory(...sources: ProfileHistoryItem[][]): ProfileHistoryItem[] {
 const items=new Map<string,ProfileHistoryItem>();
 for(const source of sources) for(const item of source) if(!items.has(item.id)) items.set(item.id,item);
 const time=(item:ProfileHistoryItem)=>Number.isFinite(item.occurredAt.getTime())?item.occurredAt.getTime():0;
 return [...items.values()].sort((a,b)=>time(b)-time(a)||a.id.localeCompare(b.id));
}
