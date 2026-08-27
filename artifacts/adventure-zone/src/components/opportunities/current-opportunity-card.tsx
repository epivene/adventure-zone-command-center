import { useEffect, useState } from "react";
import { Link } from "wouter";

import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";

type Opportunity = {
  id: string;
  eventYear: number;
  status: string;
  priority: "normal" | "high" | "urgent";
  nextActionKind: string | null;
  nextActionDueAt: string | null;
  holdReason: string | null;
};

const statusOptions = [
  "new_lead",
  "researching",
  "ready_to_contact",
  "contacted",
  "follow_up",
  "interested",
  "booking_in_progress",
  "booked",
  "not_pursuing",
  "declined",
  "no_response",
  "territory_hold",
  "needs_review",
  "cancelled",
];

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function CurrentOpportunityCard({
  organizationId,
  year,
  contactId,
  bookingId,
}: {
  organizationId: string;
  year: number;
  contactId?: string;
  bookingId?: string;
}) {
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [suggestedStatus, setSuggestedStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await apiGet<{ opportunity: Opportunity | null; suggestedStatus: string | null }>(
        `/opportunities/current?organizationId=${organizationId}&year=${year}`,
      );
      setOpportunity(response.opportunity);
      setSuggestedStatus(response.suggestedStatus ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Opportunity.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [organizationId, year]);

  async function update(patch: Record<string, unknown>) {
    if (!opportunity) return;
    const response = await apiPatch<{ opportunity: Opportunity; suggestedStatus: string | null }>(
      `/opportunities/${opportunity.id}`,
      patch,
    );
    setOpportunity(response.opportunity);
    setSuggestedStatus(response.suggestedStatus ?? null);
  }

  async function applySuggestion() {
    if (!opportunity || !suggestedStatus) return;
    const response = await apiPost<{ opportunity: Opportunity }>(
      `/opportunities/${opportunity.id}/apply-suggested-status`,
      { status: suggestedStatus },
    );
    setOpportunity(response.opportunity);
    setSuggestedStatus(null);
  }

  const context = new URLSearchParams();
  if (contactId) context.set("contactId", contactId);
  if (bookingId) context.set("bookingId", bookingId);

  return (
    <section className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4 shadow-sm" aria-labelledby="current-opportunity-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">Booking workspace</p>
          <h2 className="mt-1 text-xl font-bold" id="current-opportunity-title">Current Opportunity · {year}</h2>
        </div>
        {opportunity ? <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-orange-800">{label(opportunity.status)}</span> : null}
      </div>

      {loading ? <p className="mt-3 text-sm text-slate-600">Loading Opportunity…</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {!loading && !error && !opportunity ? <p className="mt-3 text-sm text-slate-600">No {year} Opportunity is linked to this permanent Event Profile yet.</p> : null}

      {opportunity ? (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">Status
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2" value={opportunity.status} onChange={(event) => void update({ status: event.target.value })}>
                {statusOptions.map((status) => <option key={status} value={status}>{label(status)}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">Priority
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2" value={opportunity.priority} onChange={(event) => void update({ priority: event.target.value })}>
                <option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <div className="rounded-xl bg-white p-3 text-sm">
            <p className="font-bold">Next action</p>
            <p className="mt-1 text-slate-600">{opportunity.nextActionKind ? label(opportunity.nextActionKind) : "Not scheduled"}{opportunity.nextActionDueAt ? ` · ${new Date(opportunity.nextActionDueAt).toLocaleString()}` : ""}</p>
          </div>
          {suggestedStatus ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-900">Suggested status: {label(suggestedStatus)}</p><button className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-bold text-white" type="button" onClick={() => void applySuggestion()}>Apply suggestion</button></div> : null}
          <div className="flex flex-wrap gap-2">
            <Link className="button-secondary" href={`/event-profiles/${organizationId}?${context.toString()}${context.size ? "&" : ""}action=follow-up`}>Schedule follow-up</Link>
            <Link className="button-secondary" href={`/event-profiles/${organizationId}?${context.toString()}${context.size ? "&" : ""}action=call`}>Call</Link>
            <a className="button-secondary" href="#notes">Add Note</a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
