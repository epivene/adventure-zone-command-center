import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";
import type { EventFamilyContact, EventFamilyDetail } from "@/features/event-families/event-family-types";

type Candidate = { id: string; name: string; phone: string | null; email: string | null; jobTitle?: string | null };
type Props = { family: EventFamilyDetail; onChanged: () => Promise<void> | void };

export function EventFamilyWebsiteContacts({ family, onChanged }: Props) {
  const [editingWebsite, setEditingWebsite] = useState(false);
  const [website, setWebsite] = useState(family.website ?? "");
  const [adding, setAdding] = useState(false);
  const [newMode, setNewMode] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [editingContact, setEditingContact] = useState<EventFamilyContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const websiteHref = normalizeExternalWebsite(family.website);

  async function saveWebsite() {
    setBusy(true); setError(null);
    try {
      await apiPatch(`/event-families/${family.id}/website`, { website: website.trim() || null });
      setEditingWebsite(false);
      await onChanged();
    } catch (err: any) { setError(err?.message ?? "Could not save family website"); }
    finally { setBusy(false); }
  }

  async function searchContacts(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setError(null);
    try {
      const result = await apiGet<{ contacts: Candidate[] }>(`/event-families/${family.id}/contact-candidates?q=${encodeURIComponent(query.trim())}`);
      setCandidates(result.contacts);
    } catch (err: any) { setError(err?.message ?? "Could not search contacts"); }
    finally { setBusy(false); }
  }

  async function attachSelected() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await apiPost(`/event-families/${family.id}/contacts`, { contactId: selected.id, role: null, makePrimary: family.contacts.length === 0 });
      setAdding(false); setSelected(null); setCandidates([]); setQuery("");
      await onChanged();
    } catch (err: any) { setError(err?.message ?? "Could not attach contact"); }
    finally { setBusy(false); }
  }

  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    setBusy(true); setError(null);
    try {
      await apiPost(`/event-families/${family.id}/contacts/new`, {
        name,
        phone: String(data.get("phone") ?? "").trim() || null,
        email: String(data.get("email") ?? "").trim() || null,
        role: String(data.get("role") ?? "").trim() || null,
        makePrimary: data.get("makePrimary") === "on" || family.contacts.length === 0,
      });
      setAdding(false); setNewMode(false);
      await onChanged();
    } catch (err: any) { setError(err?.message ?? "Could not create contact"); }
    finally { setBusy(false); }
  }

  async function saveRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingContact) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await apiPatch(`/event-families/${family.id}/contacts/${editingContact.contactId}`, {
        role: String(data.get("role") ?? "").trim() || null,
        isPrimary: data.get("isPrimary") === "on",
      });
      setEditingContact(null);
      await onChanged();
    } catch (err: any) { setError(err?.message ?? "Could not update family contact"); }
    finally { setBusy(false); }
  }

  async function removeContact(contact: EventFamilyContact) {
    if (!window.confirm(`Remove ${contact.name} from ${family.name}? The CRM contact and its history will stay intact.`)) return;
    setBusy(true); setError(null);
    try {
      await apiDelete(`/event-families/${family.id}/contacts/${contact.contactId}`);
      await onChanged();
    } catch (err: any) { setError(err?.message ?? "Could not remove family contact"); }
    finally { setBusy(false); }
  }

  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="family-website-contacts-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-bold" id="family-website-contacts-title">Website &amp; Contacts</h2><p className="mt-1 text-sm text-slate-500">Shared family-level information. Member-event contacts stay separate.</p></div>
        <button className="button-secondary" type="button" onClick={() => { setAdding(true); setNewMode(false); setError(null); }}>+ Add contact</button>
      </div>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}

      <div className="rounded-lg bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Website</p><p className="text-sm font-medium">{family.website || "Not recorded"}</p></div>
          <div className="flex gap-2">{websiteHref ? <a className="button-secondary" href={websiteHref} rel="noreferrer noopener" target="_blank">Visit website</a> : null}<button className="button-secondary" type="button" onClick={() => { setWebsite(family.website ?? ""); setEditingWebsite(true); }}>Edit website</button></div>
        </div>
        {editingWebsite ? <div className="mt-3 flex flex-col gap-2 sm:flex-row"><label className="grid flex-1 gap-1 text-sm font-semibold">Family website<input aria-label="Family website" value={website} onChange={(e) => setWebsite(e.currentTarget.value)} /></label><button className="button-primary self-end" disabled={busy} type="button" onClick={() => void saveWebsite()}>Save website</button><button className="button-secondary self-end" type="button" onClick={() => setEditingWebsite(false)}>Cancel</button></div> : null}
      </div>

      <div className="grid gap-2">
        {family.contacts.length ? family.contacts.map((contact) => (
          <article key={contact.contactId} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><Link className="font-bold text-orange-700 hover:underline" href={`/contacts/${contact.contactId}`}>{contact.name}</Link>{contact.isPrimary ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-900">Primary</span> : null}</div>{contact.role ? <p className="text-sm text-slate-600">{contact.role}</p> : null}<p className="text-sm text-slate-600">{[contact.phone, contact.email].filter(Boolean).join(" · ") || "No phone or email"}</p></div>
              <div className="flex flex-wrap gap-2"><Link className="button-secondary" href={`/contacts/${contact.contactId}/edit`}>Edit CRM contact</Link><button className="button-secondary" type="button" aria-label={`Edit family contact ${contact.name}`} onClick={() => setEditingContact(contact)}>Family role / Primary</button><button className="button-secondary" type="button" aria-label={`Remove ${contact.name} from family`} onClick={() => void removeContact(contact)}>Remove</button></div>
            </div>
            {editingContact?.contactId === contact.contactId ? <form className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3" onSubmit={saveRelationship}><label className="grid gap-1 text-sm font-semibold">Family role<input name="role" defaultValue={contact.role ?? ""} /></label><label className="flex items-center gap-2 text-sm font-semibold"><input aria-label="Primary family contact" name="isPrimary" type="checkbox" defaultChecked={contact.isPrimary} />Primary family contact</label><div className="flex gap-2"><button className="button-primary" disabled={busy} type="submit">Save family contact</button><button className="button-secondary" type="button" onClick={() => setEditingContact(null)}>Cancel</button></div></form> : null}
          </article>
        )) : <p className="text-sm text-slate-500">No family-level contacts yet.</p>}
      </div>

      {adding ? <div className="grid gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Add family contact</h3><button className="button-secondary" type="button" onClick={() => setAdding(false)}>Close</button></div>
        {!newMode ? <>
          <button className="button-secondary justify-self-start" type="button" onClick={() => setNewMode(true)}>Create new contact</button>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={searchContacts}><label className="grid flex-1 gap-1 text-sm font-semibold">Search existing contacts<input aria-label="Search existing contacts" value={query} onChange={(e) => setQuery(e.currentTarget.value)} /></label><button className="button-secondary self-end" type="submit" disabled={busy}>Search contacts</button></form>
          {candidates.length ? <ul className="grid gap-1">{candidates.map((candidate) => <li key={candidate.id}><button type="button" aria-label={`${candidate.name} ${candidate.phone ?? ""} ${candidate.email ?? ""}`} className={selected?.id === candidate.id ? "w-full rounded-lg bg-white p-3 text-left ring-2 ring-orange-300" : "w-full rounded-lg bg-white p-3 text-left"} onClick={() => setSelected(candidate)}><span className="font-semibold">{candidate.name}</span><span className="block text-sm text-slate-600">{[candidate.phone, candidate.email, candidate.jobTitle].filter(Boolean).join(" · ")}</span></button></li>)}</ul> : null}
          <button className="button-primary justify-self-end" type="button" disabled={!selected || busy} onClick={() => void attachSelected()}>Attach contact</button>
        </> : <form className="grid gap-3" onSubmit={createContact}><label className="grid gap-1 text-sm font-semibold">Contact name<input aria-label="Contact name" name="name" required /></label><div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Phone<input name="phone" /></label><label className="grid gap-1 text-sm font-semibold">Email<input name="email" type="email" /></label></div><label className="grid gap-1 text-sm font-semibold">Family role<input name="role" /></label><label className="flex items-center gap-2 text-sm font-semibold"><input name="makePrimary" type="checkbox" />Primary family contact</label><div className="flex gap-2"><button className="button-primary" disabled={busy} type="submit">Create and attach</button><button className="button-secondary" type="button" onClick={() => setNewMode(false)}>Back</button></div></form>}
      </div> : null}
    </section>
  );
}
