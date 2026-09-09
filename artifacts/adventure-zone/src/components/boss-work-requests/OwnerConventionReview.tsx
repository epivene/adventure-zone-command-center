import { useEffect, useState } from "react";
import type { ConventionSubmission } from "@/features/boss-work-requests/boss-work-request-types";
import { applyConventionSubmission, previewConventionSubmission } from "@/features/boss-work-requests/owner-boss-work-request-api";

export function OwnerConventionReview({ requestId, submission, reload }: {
  requestId: string; submission: ConventionSubmission; reload: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [contactId, setContactId] = useState("");
  const [createOrganization, setCreateOrganization] = useState(false);
  const [createContact, setCreateContact] = useState(false);
  const [followUpDueAt, setFollowUpDueAt] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { previewConventionSubmission(requestId, submission.id).then(setPreview).catch((e) => setError(e.message)); }, [requestId, submission.id]);
  if (submission.appliedAt) return <div className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Applied to the CRM.</div>;

  async function apply() {
    setWorking(true); setError("");
    try {
      await applyConventionSubmission(requestId, submission.id, {
        organizationId: organizationId || null, contactId: contactId || null,
        createOrganization, createContact,
        followUpDueAt: followUpDueAt ? new Date(followUpDueAt).toISOString() : null,
      });
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not apply notes."); }
    finally { setWorking(false); }
  }

  return (
    <div className="grid gap-3 rounded-xl border p-4">
      <div><p className="font-bold">{submission.payload.eventName}</p><p className="text-sm text-muted-foreground">{submission.payload.contactName} · {submission.payload.organizationName}</p></div>
      <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{[
        submission.payload.packageInterest?.length ? `Interested in: ${submission.payload.packageInterest.join(", ")}` : "",
        submission.payload.personalDetails, submission.payload.nextStep, submission.payload.notes,
      ].filter(Boolean).join("\n") || "No additional notes."}</div>
      {preview && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold">Existing profile
            <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className="min-h-11 rounded-lg border bg-background px-2">
              <option value="">Choose one…</option>
              {preview.organizationMatches.map((item: any) => <option key={item.id} value={item.id}>{item.name} — {item.city || ""}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold">Existing contact
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="min-h-11 rounded-lg border bg-background px-2">
              <option value="">Choose one…</option>
              {preview.contactMatches.map((item: any) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        <label><input type="checkbox" checked={createOrganization} onChange={(e) => setCreateOrganization(e.target.checked)} /> Create a new profile</label>
        <label><input type="checkbox" checked={createContact} onChange={(e) => setCreateContact(e.target.checked)} /> Create a new contact</label>
      </div>
      <label className="grid gap-1 text-xs font-semibold">Optional follow-up
        <input type="datetime-local" value={followUpDueAt} onChange={(e) => setFollowUpDueAt(e.target.value)} className="min-h-11 rounded-lg border bg-background px-3" />
      </label>
      {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
      <button disabled={working} onClick={() => void apply()} className="min-h-12 rounded-xl bg-primary px-4 font-bold text-primary-foreground">
        {working ? "Applying…" : "Approve & Apply to CRM"}
      </button>
    </div>
  );
}
