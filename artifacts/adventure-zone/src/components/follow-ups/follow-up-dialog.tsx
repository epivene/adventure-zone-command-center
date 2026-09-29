import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { createFollowUpAction, editFollowUpAction } from "@/actions/follow-ups";
import { FOLLOW_UP_KINDS } from "@/features/follow-ups/follow-up-kinds";
import type { FollowUpRecord } from "@/features/follow-ups/follow-up-types";
import { businessDateKey, parseBusinessDate } from "@/lib/business-date";
import { FollowUpDatePicker } from "./follow-up-date-picker";

export function FollowUpDialog({ open, onOpenChange, profileId, contactId, bookingId, profileName, followUp, onSaved, onEdit }: {
  open: boolean; onOpenChange(open: boolean): void; profileId?: string;
  contactId?: string | null; bookingId?: string | null; profileName?: string;
  followUp?: { id: string; kind: string; dueAt: Date };
  onSaved?(record: FollowUpRecord): void;
  onEdit?(id: string, input: {kind: string; dueAt: string}): Promise<{ok: boolean; error?: string}>;
}) {
  const [kind,setKind]=useState("email"), [due,setDue]=useState(""), [error,setError]=useState(""), [saving,setSaving]=useState(false);
  const busy=useRef(false);
  const opener=useRef<HTMLElement | null>(null);
  useEffect(() => { if(open) { opener.current=document.activeElement as HTMLElement; setKind(followUp?.kind ?? "email"); setDue(followUp ? businessDateKey(new Date(followUp.dueAt)) : ""); setError(""); } }, [open, followUp?.id, profileId]);
  async function save() {
    const date=parseBusinessDate(due); if(!date || busy.current) return;
    busy.current=true;setSaving(true);setError("");
    try {
      if (followUp && onEdit) {
        const result=await onEdit(followUp.id,{kind,dueAt:date.toISOString()});
        if(!result.ok) {setError(result.error ?? "Could not save follow-up.");return;}
      } else {
        const result=followUp ? await editFollowUpAction({followUpId:followUp.id,kind,dueAt:date,completed:false,outcome:null}) : await createFollowUpAction({organizationId:profileId!,contactId,bookingId,kind,dueAt:date});
        if(!result.ok) {setError(result.error);return;}
        onSaved?.(result.followUp);
      }
      window.dispatchEvent(new Event("follow-ups-changed"));
      onOpenChange(false);
    } catch(cause) {setError(cause instanceof Error ? cause.message : "Could not save follow-up.");}
    finally {busy.current=false;setSaving(false);}
  }
  return <Dialog open={open} onOpenChange={value => {if(!busy.current)onOpenChange(value);}}>
    <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden max-sm:h-[90dvh]" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }} onEscapeKeyDown={event => {if(busy.current)event.preventDefault();}} onPointerDownOutside={event => {if(busy.current)event.preventDefault();}}>
      <DialogTitle>{followUp ? "Edit follow-up" : "Schedule follow-up"}</DialogTitle>
      <DialogDescription>{profileName ?? "This profile"} · Choose the next action and due date.</DialogDescription>
      <div className="min-h-0 overflow-y-auto pr-1"><fieldset disabled={saving} className="grid gap-4">
        <label className="grid gap-1 text-sm font-semibold">Follow-up type<select className="rounded-md border bg-background p-2 text-base" value={kind} onChange={event=>setKind(event.target.value)}>{FOLLOW_UP_KINDS.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}{!FOLLOW_UP_KINDS.some(item=>item.value===kind) ? <option value={kind}>{kind.replaceAll("_"," ")}</option>:null}</select></label>
        <FollowUpDatePicker value={due} onChange={setDue}/>
      </fieldset></div>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p>:null}
      <div className="flex shrink-0 gap-2 border-t pt-3"><button className="button-primary" type="button" disabled={saving || !parseBusinessDate(due)} onClick={()=>void save()}>{saving ? "Saving…" : "Save follow-up"}</button><button className="button-secondary" type="button" disabled={saving} onClick={()=>onOpenChange(false)}>Cancel</button></div>
    </DialogContent>
  </Dialog>;
}
