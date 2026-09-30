import { useState } from "react";
import { apiGet } from "@/lib/auth-token";
type ImageChoice = {url:string;label:string;dataUrl:string;sourceUrl:string};
export function WebsitePhotoPicker({profileId,onSave}:{profileId:string;onSave:(dataUrl:string,sourceUrl?:string)=>Promise<void>}) {
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[images,setImages]=useState<ImageChoice[]>([]),[error,setError]=useState("");
 async function load() {
  setOpen(true);setBusy(true);setError("");setImages([]);
  try {const result=await apiGet<{images:ImageChoice[]}>(`/event-profiles/${profileId}/website-photos`);setImages(result.images);if(!result.images.length)setError("No usable website images found. You can still upload a photo.");}
  catch(e){setError(e instanceof Error ? e.message : "Could not load website images.");}finally{setBusy(false);}
 }
 async function select(image:ImageChoice) {
  setBusy(true);setError("");
  try {await onSave(image.dataUrl,image.url);setOpen(false);}catch(e){setError(e instanceof Error ? e.message : "Could not save photo.");}finally{setBusy(false);}
 }
 return <>
  <button type="button" onClick={load} disabled={busy} className="mt-3 block text-xs font-semibold text-[#315b66]">Use website image</button>
  {open && <div role="dialog" aria-modal="true" aria-label="Choose website photo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
   <div className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
    <h2 className="text-lg font-semibold">Choose an event photo or logo</h2>
    <p className="my-2 text-sm">Choose an image that represents this event. Its source will be saved with the profile.</p>
    {busy && <p role="status">Loading…</p>}{error && <p role="alert">{error}</p>}
    <div className="grid grid-cols-2 gap-3">{images.map(image=><button type="button" key={image.url} disabled={busy} onClick={()=>select(image)} className="rounded border p-2 text-left"><img src={image.dataUrl} alt={image.label} className="h-28 w-full object-contain"/><span className="text-xs">{image.label}</span></button>)}</div>
    <button type="button" disabled={busy} onClick={()=>setOpen(false)} className="mt-4 rounded border px-4 py-2">Close</button>
   </div>
  </div>}
 </>;
}
