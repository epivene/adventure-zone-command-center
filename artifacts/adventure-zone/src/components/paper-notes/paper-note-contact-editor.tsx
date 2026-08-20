import { PaperNotePhoneEditor } from "./paper-note-phone-editor";
import type {
  PaperNoteReviewedContact,
  PaperNoteReviewedPhone,
  PaperNoteSavedContact,
} from "@/features/paper-notes/paper-note-review-types";

type FieldConflict = {
  kind: "field";
  fieldPath: string;
  decision: "keep_saved" | "replace_saved" | "ignore_paper_note_only";
  targetId: string | null;
};

function fieldConflict(value: unknown): FieldConflict | null {
  return value && typeof value === "object" && (value as { kind?: unknown }).kind === "field"
    ? value as FieldConflict
    : null;
}

export function PaperNoteContactEditor({
  contact,
  contactIndex,
  savedContacts,
  conflicts,
  onContactChange,
  onPhoneChange,
  onConflictChange,
}: {
  contact: PaperNoteReviewedContact;
  contactIndex: number;
  savedContacts: PaperNoteSavedContact[];
  conflicts: Record<string, unknown>;
  onContactChange(patch: Partial<PaperNoteReviewedContact>): void;
  onPhoneChange(phoneIndex: number, patch: Partial<PaperNoteReviewedPhone>): void;
  onConflictChange(path: string, value: unknown | null): void;
}) {
  const selected = contact.selectedContactId
    ? savedContacts.find((candidate) => candidate.id === contact.selectedContactId) ?? null
    : null;
  const namePath = `contacts.${contactIndex}.name`;
  const emailPath = `contacts.${contactIndex}.email`;
  const nameDecision = fieldConflict(conflicts[namePath]);
  const emailDecision = fieldConflict(conflicts[emailPath]);

  function changeMode(mode: PaperNoteReviewedContact["mode"]) {
    onContactChange({
      mode,
      selectedContactId: mode === "existing_contact" ? contact.selectedContactId : null,
    });
    onConflictChange(namePath, null);
    onConflictChange(emailPath, null);
    contact.phones.forEach((_phone, phoneIndex) => {
      onConflictChange(`contacts.${contactIndex}.phones.${phoneIndex}`, null);
    });
  }

  function setFieldDecision(path: string, decision: FieldConflict["decision"] | "") {
    if (!decision) {
      onConflictChange(path, null);
      return;
    }
    onConflictChange(path, {
      kind: "field",
      fieldPath: path,
      decision,
      targetId: contact.selectedContactId,
    } satisfies FieldConflict);
  }

  return (
    <section className="mt-6 grid gap-3 border-t border-slate-200 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">Contact {contactIndex + 1}</h3>
        {contact.primary ? <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-900">Primary paper contact</span> : null}
      </div>

      <label className="grid gap-1 text-sm font-semibold text-slate-700">
        Contact handling
        <select aria-label="Contact handling" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" value={contact.mode} onChange={(event) => changeMode(event.target.value as PaperNoteReviewedContact["mode"])}>
          <option value="new_contact">Create a new contact</option>
          <option value="existing_contact" disabled={!savedContacts.length}>Link an existing contact</option>
          <option value="note_only">History only — do not create/change a contact</option>
        </select>
      </label>

      {contact.mode === "existing_contact" ? (
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Existing contact
          <select aria-label="Existing contact" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" value={contact.selectedContactId ?? ""} onChange={(event) => {
            onContactChange({ selectedContactId: event.target.value || null });
            onConflictChange(namePath, null);
            onConflictChange(emailPath, null);
            contact.phones.forEach((_phone, phoneIndex) => onConflictChange(`contacts.${contactIndex}.phones.${phoneIndex}`, null));
          }}>
            <option value="">Choose saved contact…</option>
            {savedContacts.map((saved) => <option key={saved.id} value={saved.id}>{saved.name}{saved.role ? ` · ${saved.role}` : ""}{saved.email ? ` · ${saved.email}` : ""}</option>)}
          </select>
        </label>
      ) : null}

      <label className="grid gap-1 text-sm font-semibold text-slate-700">Contact name from paper<input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={contact.name} onChange={(event) => onContactChange({ name: event.target.value })} /></label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">Role<input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={contact.role ?? ""} onChange={(event) => onContactChange({ role: event.target.value || null })} /></label>
      <label className="grid gap-1 text-sm font-semibold text-slate-700">Email from paper<input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" type="email" value={contact.email ?? ""} onChange={(event) => onContactChange({ email: event.target.value || null })} /></label>

      {contact.mode === "note_only" ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">This person and their paper contact details will stay in the historical note only.</p> : null}

      {contact.mode === "existing_contact" && selected ? (
        <div className="grid gap-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
          <p className="text-sm font-bold text-orange-950">Compare with saved contact</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-3 text-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Saved name</p><p className="mt-1 text-slate-900">{selected.name || "—"}</p></div>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">Name decision<select className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" value={nameDecision?.decision ?? ""} onChange={(event) => setFieldDecision(namePath, event.target.value as FieldConflict["decision"] | "")}><option value="">Choose…</option><option value="keep_saved">Keep saved name</option><option value="replace_saved">Replace saved name with paper name</option><option value="ignore_paper_note_only">Keep paper name in history only</option></select></label>
          </div>
          {contact.email ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-white p-3 text-sm"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Saved email</p><p className="mt-1 break-all text-slate-900">{selected.email || "No saved email"}</p></div>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">Email decision<select className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" value={emailDecision?.decision ?? ""} onChange={(event) => setFieldDecision(emailPath, event.target.value as FieldConflict["decision"] | "")}><option value="">Choose…</option><option value="keep_saved">Keep saved email</option><option value="replace_saved">Replace saved email with paper email</option><option value="ignore_paper_note_only">Keep paper email in history only</option></select></label>
            </div>
          ) : null}
        </div>
      ) : null}

      {contact.phones.map((phone, phoneIndex) => (
        <PaperNotePhoneEditor
          key={phone.key}
          phone={phone}
          path={`contacts.${contactIndex}.phones.${phoneIndex}`}
          savedPhones={selected?.phones ?? []}
          conflict={conflicts[`contacts.${contactIndex}.phones.${phoneIndex}`]}
          requireDecision={contact.mode === "existing_contact"}
          allowPrimaryChoice={contact.mode === "new_contact"}
          onChange={(patch) => onPhoneChange(phoneIndex, patch)}
          onConflict={(value) => onConflictChange(`contacts.${contactIndex}.phones.${phoneIndex}`, value)}
        />
      ))}
    </section>
  );
}
