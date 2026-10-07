import { useEffect, useRef, useState } from "react";
export function emailHtmlDocument(html: string, showImages=false): string {
 const policy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:"+(showImages?" https:":"")+"; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="'+policy+'"><style>html,body{margin:0;padding:0;background:white;color:#202124;font:14px/1.5 Arial,sans-serif;overflow-wrap:anywhere}img,video{max-width:100%!important;height:auto}table{max-width:100%!important}pre{white-space:pre-wrap}body{padding:8px;box-sizing:border-box}@media(max-width:640px){table[width]{width:100%!important}td{overflow-wrap:anywhere}}</style></head><body>'+html+'</body></html>';
}
export function emailLinkUrl(href: string): string | null {
 try {const url=new URL(href);return ["https:","http:","mailto:"].includes(url.protocol)?url.href:null;} catch {return null;}
}
export function EmailMessageBody({bodyText,bodyHtml,title="Email content"}: {bodyText:string;bodyHtml?:string;title?:string}) {
 const [imageConsent,setImageConsent]=useState<{html?:string;enabled:boolean}>({enabled:false}),[height,setHeight]=useState(320);
 const showImages=imageConsent.html===bodyHtml && imageConsent.enabled;
 const frame=useRef<HTMLIFrameElement>(null);
 useEffect(()=>{
  if(!bodyHtml) return;
  const element=frame.current;
  let observer: ResizeObserver | undefined;
  let bodyElement: HTMLElement | undefined;
  const openLink=(event: MouseEvent)=>{
   const target=event.target as Element | null;
   const anchor=typeof target?.closest==="function"?target.closest("a[href]"):null;
   if(!anchor)return;
   event.preventDefault();
   const url=emailLinkUrl(anchor.getAttribute("href") || "");
   if(url)window.open(url,"_blank","noopener,noreferrer");
  };
  const resize=()=>{
   try {const body=element?.contentDocument?.body;if(!body)return;setHeight(Math.max(120,Math.min(10000,Math.ceil(body.scrollHeight)+20)));} catch {}
  };
  const watch=()=>{observer?.disconnect();bodyElement?.removeEventListener("click",openLink);resize();try {const body=element?.contentDocument?.body;if(body){bodyElement=body;body.addEventListener("click",openLink);observer=new ResizeObserver(resize);observer.observe(body);}} catch {}};
  element?.addEventListener("load",watch);watch();
  return ()=>{element?.removeEventListener("load",watch);observer?.disconnect();bodyElement?.removeEventListener("click",openLink);};
 },[bodyHtml,showImages]);
 if(bodyHtml?.trim()) return <div className="mt-3 min-w-0">
  <iframe ref={frame} title={title} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={emailHtmlDocument(bodyHtml,showImages)} className="block w-full min-w-0 rounded bg-white" style={{height}} />
  <div className="mt-2 flex flex-wrap items-start gap-3 text-xs">
   <button type="button" className="min-h-11 text-primary underline" onClick={()=>setImageConsent({html:bodyHtml,enabled:!showImages})}>{showImages?"Hide external images":"Show external images"}</button>
   {bodyText?<details className="min-w-0 flex-1"><summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">Plain text</summary><p className="whitespace-pre-wrap break-words">{bodyText}</p></details>:null}
  </div>
 </div>;
 const split=bodyText.search(/(?:^|\n)(?:On .{5,300}wrote:|>)/);
 return <><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{(split<0?bodyText:bodyText.slice(0,split)) || "(No readable message body)"}</p>{split>=0?<details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-xs text-muted-foreground">Quoted conversation</summary><p className="whitespace-pre-wrap break-words text-sm">{bodyText.slice(split)}</p></details>:null}</>;
}
