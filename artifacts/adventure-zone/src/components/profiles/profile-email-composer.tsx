import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";

export type ProfileEmailDraft = {
  id: string;
  organizationId: string;
  contactId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  state: string;
};
type Contact = { id: string; name: string; email: string | null };

export function ProfileEmailComposer({ organizationId, profileName, contacts, draft, onClose, onSaved }: {
  organizationId: string;
  profileName: string;
  contacts: Contact[];
  draft: ProfileEmailDraft | null;
  onClose(): void;
  onSaved(draft: ProfileEmailDraft): void;
}) {
  const recipients = contacts.filter((contact) => contact.email?.trim());
  const [contactId, setContactId] = useState(draft?.contactId ?? recipients[0]?.id ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recipientEmail = draft?.recipientEmail ?? recipients.find((contact) => contact.id === contactId)?.email;

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = draft
        ? await apiPatch<{ draft: ProfileEmailDraft }>(`/office-admin/email-drafts/${draft.id}`, { subject, body })
        : await apiPost<{ draft: ProfileEmailDraft }>("/office-admin/email-drafts", { organizationId, contactId, subject, body });
      onSaved(result.draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={(event) => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>{draft ? "Edit Email Draft" : "Create Email"}</DialogTitle>
        <DialogDescription>{profileName} · Save a draft here to review later. Nothing is sent when you save.</DialogDescription>
      </DialogHeader>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {!draft && !recipients.length ? <p role="status">Add an email address to a contact on this profile before creating an email.</p> : <>
        {draft ? <p className="text-sm">To: {recipientEmail}</p> : <label className="grid gap-1 text-sm font-semibold">Recipient
          <select value={contactId} disabled={busy} onChange={(event) => setContactId(event.target.value)}>
            {recipients.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.email}</option>)}
          </select>
        </label>}
        {preview ? <section aria-label="Email preview" className="grid gap-3 rounded-lg border p-4">
          <p className="text-sm">To: {recipientEmail}</p>
          <h3 className="font-bold">{subject || "(No subject)"}</h3>
          <p className="whitespace-pre-wrap break-words text-sm">{body || "(No message)"}</p>
        </section> : <>
          <label className="grid gap-1 text-sm font-semibold">Subject<input autoFocus maxLength={500} disabled={busy} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">Email<textarea rows={12} maxLength={50000} disabled={busy} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        </>}
        <div className="flex flex-wrap gap-2">
          <button className="button-primary" type="button" disabled={busy || !contactId || !subject.trim() || !body.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save Draft"}</button>
          <button className="button-secondary" type="button" disabled={busy} onClick={() => setPreview(!preview)}>{preview ? "Edit Email" : "Preview Email"}</button>
        </div>
      </>}
      <button className="button-secondary w-fit" type="button" disabled={busy} onClick={onClose}>Close</button>
    </DialogContent>
  </Dialog>;
}

export function ProfileEmailDrafts({ organizationId, revision, onCreate, onEdit }: {
  organizationId: string;
  revision: number;
  onCreate(): void;
  onEdit(draft: ProfileEmailDraft): void;
}) {
  const [drafts, setDrafts] = useState<ProfileEmailDraft[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setDrafts([]);
    apiGet<{ drafts: ProfileEmailDraft[] }>(`/office-admin/profile-email-drafts/${organizationId}`)
      .then((result) => { if (active) setDrafts(result.drafts.filter((draft) => ["draft", "needs_changes"].includes(draft.state))); })
      .catch(() => { if (active) setError("Could not load saved email drafts. Reopen Emails to try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, revision]);
  return <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/20">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold">Email drafts</h2>
      <button type="button" className="button-primary inline-flex items-center gap-2" onClick={onCreate}><Mail className="h-4 w-4" />Create Email</button>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : loading ? <p className="mt-3 text-sm">Loading drafts…</p> : !drafts.length ? <p className="mt-3 text-sm text-slate-500">No saved drafts yet. Create an email for a contact on this profile.</p> : <ul className="mt-3 grid gap-2">
      {drafts.map((draft) => <li key={draft.id}><button type="button" className="w-full rounded-lg border p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900" onClick={() => onEdit(draft)}>
        <span className="block font-semibold">{draft.subject}</span><span className="text-sm text-slate-500">Draft · {draft.recipientEmail} · Open to edit</span>
      </button></li>)}
    </ul>}
  </section>;
}
