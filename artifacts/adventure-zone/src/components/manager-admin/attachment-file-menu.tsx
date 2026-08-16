import { useState } from "react";
import { FolderPlus, X } from "lucide-react";

type Destination="expense_receipt"|"incident_photo"|"equipment_handoff_photo"|"general_leg_document";
export function AttachmentFileMenu({attachment,legs,onFile}:{attachment:{id:string;fileName:string|null};legs:Array<{id:string;name:string}>;onFile:(input:{attachmentId:string;destination:Destination;destinationMetadata:Record<string,string>})=>Promise<void>}){
  const [open,setOpen]=useState(false);const [legId,setLegId]=useState(legs[0]?.id??"");const [destination,setDestination]=useState<Destination>("expense_receipt");
  const [expenseId,setExpenseId]=useState("");const [receiptId,setReceiptId]=useState("");const [incidentId,setIncidentId]=useState("");const [incidentAttachmentId,setIncidentAttachmentId]=useState("");const [destinationId,setDestinationId]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function submit(){if(!legId||busy)return;setBusy(true);setError("");try{
    const destinationMetadata:Record<string,string>={legId};
    if(destination==="expense_receipt"){destinationMetadata.expenseId=expenseId;destinationMetadata.receiptId=receiptId;destinationMetadata.label="Expenses → Receipt";}
    else if(destination==="incident_photo"){destinationMetadata.incidentId=incidentId;destinationMetadata.attachmentId=incidentAttachmentId;destinationMetadata.label="Incident → Photo";}
    else {destinationMetadata.destinationId=destinationId;destinationMetadata.label=destination==="equipment_handoff_photo"?"Equipment handoff → Photo":"General leg documents";}
    await onFile({attachmentId:attachment.id,destination,destinationMetadata});setOpen(false);
  }catch(e){setError(e instanceof Error?e.message:"Could not add file");}finally{setBusy(false);}}
  return <div className="relative inline-block">
    <button className="button-secondary" onClick={()=>setOpen(true)} type="button"><FolderPlus className="mr-1 inline h-4 w-4"/>Add to leg…</button>
    {open?<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 sm:items-center"><section className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" role="dialog" aria-modal="true"><div className="flex items-center justify-between"><div><h2 className="font-bold">Add file to leg record</h2><p className="text-sm text-slate-500">{attachment.fileName||"Attachment"}</p></div><button aria-label="Close" onClick={()=>setOpen(false)} type="button"><X className="h-5 w-5"/></button></div>
      <label className="mt-3 block text-sm font-semibold">Leg<select aria-label="Leg" className="mt-1 w-full rounded-lg border p-2 font-normal" onChange={e=>setLegId(e.target.value)} value={legId}>{legs.map(leg=><option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label>
      <label className="mt-3 block text-sm font-semibold">File as<select aria-label="File as" className="mt-1 w-full rounded-lg border p-2 font-normal" onChange={e=>setDestination(e.target.value as Destination)} value={destination}><option value="expense_receipt">Expense receipt</option><option value="incident_photo">Incident photo</option><option value="equipment_handoff_photo">Equipment handoff photo</option><option value="general_leg_document">General leg document</option></select></label>
      {destination==="expense_receipt"?<><label className="mt-3 block text-sm font-semibold">Expense ID<input aria-label="Expense ID" className="mt-1 w-full rounded-lg border p-2 font-normal" value={expenseId} onChange={e=>setExpenseId(e.target.value)}/></label><label className="mt-3 block text-sm font-semibold">Receipt ID<input aria-label="Receipt ID" className="mt-1 w-full rounded-lg border p-2 font-normal" value={receiptId} onChange={e=>setReceiptId(e.target.value)}/></label></>:null}
      {destination==="incident_photo"?<><label className="mt-3 block text-sm font-semibold">Incident ID<input aria-label="Incident ID" className="mt-1 w-full rounded-lg border p-2 font-normal" value={incidentId} onChange={e=>setIncidentId(e.target.value)}/></label><label className="mt-3 block text-sm font-semibold">Photo record ID<input aria-label="Photo record ID" className="mt-1 w-full rounded-lg border p-2 font-normal" value={incidentAttachmentId} onChange={e=>setIncidentAttachmentId(e.target.value)}/></label></>:null}
      {destination==="equipment_handoff_photo"?<label className="mt-3 block text-sm font-semibold">Handoff ID<input aria-label="Handoff ID" className="mt-1 w-full rounded-lg border p-2 font-normal" value={destinationId} onChange={e=>setDestinationId(e.target.value)}/></label>:null}
      {destination==="general_leg_document"?<label className="mt-3 block text-sm font-semibold">Document group / record ID<input aria-label="Document record ID" className="mt-1 w-full rounded-lg border p-2 font-normal" value={destinationId} onChange={e=>setDestinationId(e.target.value)}/></label>:null}
      {error?<p className="mt-2 text-sm font-semibold text-red-600" role="alert">{error}</p>:null}<button className="button-primary mt-4 w-full" disabled={busy} onClick={()=>void submit()} type="button">{busy?"Adding…":"Add file"}</button>
    </section></div>:null}
  </div>;
}
