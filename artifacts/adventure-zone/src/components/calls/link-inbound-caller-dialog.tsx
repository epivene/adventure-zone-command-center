import { useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@workspace/avz-crm/components/ui/dialog";
export function LinkInboundCallerDialog({ onLink }: { onLink: (ids: { organizationId: string; contactId: string; phoneId: string }) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [organizationId, setOrganizationId] = useState(""); const [contactId, setContactId] = useState(""); const [phoneId, setPhoneId] = useState("");
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" type="button" variant="outline">Link profile</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Link inbound caller</DialogTitle><DialogDescription>Choose existing stored IDs. This never changes profile data automatically.</DialogDescription></DialogHeader>
    <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void onLink({ organizationId, contactId, phoneId }).then(() => setOpen(false)); }}>
      <label>Organization ID<input required value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} /></label><label>Contact ID<input required value={contactId} onChange={(event) => setContactId(event.target.value)} /></label><label>Phone ID<input required value={phoneId} onChange={(event) => setPhoneId(event.target.value)} /></label><Button type="submit">Link existing profile</Button>
    </form></DialogContent></Dialog>;
}