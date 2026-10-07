export type EmailDateSource = { internalDateMs?: number | string | null; date?: string; headers?: {date?: string} };
export function emailTime(value: EmailDateSource): number | null {
 const raw=value.internalDateMs;
 const millis=typeof raw==="number" ? raw : typeof raw==="string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
 if(Number.isFinite(millis) && millis>0 && Number.isFinite(new Date(millis).getTime())) return millis;
 const parsed=Date.parse(value.date || value.headers?.date || "");
 return Number.isFinite(parsed) ? parsed : null;
}
export function newestEmails<T extends EmailDateSource>(items: readonly T[]): T[] {
 return items.map((item,index)=>({item,index})).sort((a,b)=>(emailTime(b.item) ?? -Infinity)-(emailTime(a.item) ?? -Infinity) || a.index-b.index).map(row=>row.item);
}
export function formatEmailDate(value: EmailDateSource, compact=false, now=new Date()): string {
 const time=emailTime(value);
 if(time===null) return "Date unavailable";
 const date=new Date(time);
 if(!compact) return date.toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
 if(date.toDateString()===now.toDateString()) return date.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
 return date.toLocaleDateString(undefined,{month:"short",day:"numeric",...(date.getFullYear()!==now.getFullYear()?{year:"numeric"}:{})});
}

export function emailPreviewText(text: string): string {
 const named: Record<string,string>={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "};
 return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(original,entity:string)=>{
  if(entity[0]!=="#") return named[entity.toLowerCase()] ?? original;
  const code=entity[1].toLowerCase()==="x"?parseInt(entity.slice(2),16):Number(entity.slice(1));
  return code>0 && code<=0x10ffff && !(code>=0xd800 && code<=0xdfff)?String.fromCodePoint(code):original;
 }).replace(/[\u034f\u200b\u200c\u200d\u2060\ufeff]/g,"");
}
