export type LeadGmailDraftStateItem = {
  id: string; rowId: string; profileName: string; recipientEmail: string; subject: string;
  state: "prepared" | "created" | "retryable_error" | "manual_review";
  gmailDraftId: string | null; lastErrorCode: string | null; updatedAt: string;
};
function label(state: LeadGmailDraftStateItem["state"]) {
  if (state === "created") return "Gmail draft created";
  if (state === "retryable_error") return "Draft creation failed — retry available";
  return "Manual Gmail review required";
}
export function LeadGmailDraftStateList({ drafts }: { drafts: LeadGmailDraftStateItem[] }) {
  return <section className="grid gap-3">
    <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Lead Gmail drafts</h2><span className="text-sm text-slate-500">{drafts.length}</span></div>
    <p className="text-sm text-slate-600">These are linked Gmail draft records. They have not been sent.</p>
    {drafts.length ? <div className="grid gap-2">{drafts.map((draft) => <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={draft.id}>
      <div className="flex flex-wrap justify-between gap-2"><div><p className="font-bold">{draft.subject}</p><p className="text-sm text-slate-600">{draft.profileName} · To {draft.recipientEmail}</p></div><span className="h-fit rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{label(draft.state)}</span></div>
      {draft.lastErrorCode ? <p className="mt-2 text-sm text-amber-800">{draft.lastErrorCode}</p> : null}
      <p className="mt-2 text-xs text-slate-500">Updated {new Date(draft.updatedAt).toLocaleString()}</p>
    </article>)}</div> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No linked lead Gmail drafts yet.</p>}
  </section>;
}
