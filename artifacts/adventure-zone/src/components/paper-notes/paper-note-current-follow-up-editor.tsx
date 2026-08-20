import type { PaperNoteReviewDraft } from "@/features/paper-notes/paper-note-review-types";

type FollowUp = PaperNoteReviewDraft["currentFollowUp"];

export function PaperNoteCurrentFollowUpEditor({ followUp, contacts, onChange }: {
  followUp: FollowUp;
  contacts: PaperNoteReviewDraft["contacts"];
  onChange(patch: Partial<FollowUp>): void;
}) {
  const availableContacts = contacts.filter((contact) => contact.mode !== "note_only");
  return (
    <section className="mt-6 border-t border-slate-200 pt-5">
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
        <input aria-label="Create a current follow-up" type="checkbox" checked={followUp.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked, dueOn: event.target.checked ? followUp.dueOn : null, contactKey: event.target.checked ? followUp.contactKey : null })} />
        Create a current follow-up
      </label>
      <p className="mt-1 text-sm text-slate-500">This is separate from any old reminder written on the paper.</p>
      {followUp.enabled ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">Follow-up type
            <select aria-label="Current follow-up type" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" value={followUp.kind || "call"} onChange={(event) => onChange({ kind: event.target.value })}>
              <option value="call">Call</option><option value="email">Email</option><option value="text">Text</option><option value="mail">Mail</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">New current follow-up date
            <input aria-label="New current follow-up date" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" type="date" value={followUp.dueOn ?? ""} onChange={(event) => onChange({ dueOn: event.target.value || null })} />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">Follow-up contact
            <select aria-label="Current follow-up contact" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" value={followUp.contactKey ?? ""} onChange={(event) => onChange({ contactKey: event.target.value || null })}>
              <option value="">Use primary reviewed contact</option>
              {availableContacts.map((contact, index) => <option key={contact.key} value={contact.key}>{contact.name.trim() || `Contact ${index + 1}`}{contact.role ? ` · ${contact.role}` : ""}</option>)}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  );
}
