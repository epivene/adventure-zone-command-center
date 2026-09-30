import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
import { parse } from "parse5";
const blocked = new BlockList();
for (const [ip,prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const) blocked.addSubnet(ip,prefix,"ipv4");
const v6 = new BlockList(); v6.addSubnet("2000::",3,"ipv6");
const v6blocked = new BlockList();
for(const [ip,prefix] of [["2001::",23],["2001:db8::",32],["2002::",16]] as const) v6blocked.addSubnet(ip,prefix,"ipv6");
export function publicImageAddress(ip:string) {
 return isIP(ip) === 4 ? !blocked.check(ip,"ipv4") : isIP(ip) === 6 && v6.check(ip,"ipv6") && !v6blocked.check(ip,"ipv6");
}
function imageUrl(value:string, base?:string) {
 const url = new URL(value,base);
 if(url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Use a public HTTPS website.");
 return url;
}
export function extractWebsiteImages(html:string,base:string) {
 const found:{url:string;label:string;priority:number}[]=[];
 function walk(node:any) {
  const a = Object.fromEntries((node.attrs ?? []).map((x:any)=>[x.name,x.value]));
  const social = node.tagName === "meta" && ["og:image","twitter:image"].includes(a.property ?? a.name);
  const raw = social ? a.content : node.tagName === "img" ? a.src : null;
  if(raw) try {found.push({url:imageUrl(raw,base).href,label:a.alt || (social ? "Website featured image" : "Website image"),priority:social ? 0 : /logo/i.test(a.alt+" "+raw) ? 1 : 2});} catch {}
  for(const child of node.childNodes ?? []) walk(child);
 }
 walk(parse(html));
 return found.sort((a,b)=>a.priority-b.priority).filter((item,index,all)=>all.findIndex(x=>x.url===item.url)===index).slice(0,6).map(({url,label})=>({url,label}));
}
// Resolve once, reject mixed private/public answers, and pin the approved IP to prevent DNS rebinding.
async function download(value:string,maxBytes:number,hops=0):Promise<{bytes:Buffer;type:string;url:string}> {
 const url=imageUrl(value); const hostname=url.hostname.replace(/^\[|\]$/g,"");
 const addresses=isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await lookup(hostname,{all:true});
 if(!addresses.length || addresses.some(a=>!publicImageAddress(a.address))) throw new Error("Website address is not public.");
 const address=addresses[0];
 return new Promise((resolve,reject)=>{
  const req=request(url,{agent:false,family:address.family,lookup:((_host:any,_options:any,cb:any)=>cb(null,address.address,address.family)) as any,headers:{accept:"text/html,image/jpeg,image/png,image/webp","accept-encoding":"identity"}},res=>{
   if([301,302,303,307,308].includes(res.statusCode ?? 0)) {
    res.resume(); if(hops>=3 || !res.headers.location) {reject(new Error("Too many website redirects."));return;}
    download(new URL(res.headers.location,url).href,maxBytes,hops+1).then(resolve,reject); return;
   }
   if(res.statusCode !== 200) {res.resume();reject(new Error("Website image could not be loaded."));return;}
   const chunks:Buffer[]=[];let size=0;
   res.on("data",chunk=>{size+=chunk.length;if(size>maxBytes) {req.destroy(new Error("Website image is too large."));return;}chunks.push(chunk);});
   res.on("end",()=>resolve({bytes:Buffer.concat(chunks),type:String(res.headers["content-type"]??"").split(";")[0],url:url.href}));
   res.on("error",reject);
  });
  const timeout=setTimeout(()=>req.destroy(new Error("Website request timed out.")),8000);
  req.on("close",()=>clearTimeout(timeout));req.on("error",reject);req.end();
 });
}
export async function websitePhotos(website:string) {
 const page=await download(website,512000);
 if(!page.type.includes("html")) throw new Error("The website did not return an event page.");
 const candidates=extractWebsiteImages(page.bytes.toString("utf8"),page.url);
 const images=[];
 for(const candidate of candidates) {
  try {
   const image=await download(candidate.url,500000);
   const b=image.bytes;
   const valid=image.type === "image/png" ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : image.type === "image/jpeg" ? b[0]===255 && b[1]===216 && b[2]===255 : image.type === "image/webp" && b.subarray(0,4).toString()==="RIFF" && b.subarray(8,12).toString()==="WEBP";
   if(valid) images.push({...candidate,dataUrl:`data:${image.type};base64,${b.toString("base64")}`,sourceUrl:page.url});
  } catch { /* An unavailable candidate must not prevent other website images. */ }
 }
 return images;
}
