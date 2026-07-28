"use client";

import { useState, type FormEvent } from "react";

import {
  ActivityTimeline,
  type ActivityRevisionResult,
} from "@/components/activities/activity-timeline";
import type { ActivityTimelineItem } from "@/features/activities/activity-types";
import type { BookingStatus } from "@/features/bookings/booking-types";
import type { CallDisposition, CompleteCallInput } from "@/features/calls/call-types";
import { parseBusinessDate } from "@/lib/business-date";

export type CompleteCallResult = { ok: true } | { ok: false; error: string };

const dispositionOptions: { value: CallDisposition; label: string }[] = [
  { value: "no_answer", label: "No answer" },
  { value: "left_voicemail", label: "Left voicemail" },
  { value: "follow_up_needed", label: "Follow-up needed" },
  { value: "interested", label: "Interested" },
  { value: "proposal_contract_sent", label: "Proposal or contract sent" },
  { value: "booked", label: "Booked" },
  { value: "declined", label: "Declined" },
  { value: "move_to_last_resort", label: "Move to Last Resort" },
];

function formatDate(value: Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);
}

export function CallWorkspace({
  organization,
  contact,
  booking,
  followUpId,
  timeline,
  onComplete,
  loadRevisions = async () => ({ ok: true, revisions: [] }),
}: {
  organization: { id: string; name: string; lastResort: boolean; lastResortReason: string | null };
  contact: { id: string; name: string; phone: string | null; email: string | null } | null;
  booking: { id: string; name: string; city: string; region: string; status: BookingStatus; startsAt: Date | null } | null;
  followUpId: string | null;
  timeline: ActivityTimelineItem[];
  onComplete: (input: CompleteCallInput) => Promise<CompleteCallResult>;
  loadRevisions?: (activityId: string) => Promise<ActivityRevisionResult>;
}) {
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [note, setNote] = useState("");
  const [disposition, setDisposition] = useState<CallDisposition>("no_answer");
  const [nextActionKind, setNextActionKind] = useState("");
  const [nextActionDueAt, setNextActionDueAt] = useState("");
  const [lastResortReason, setLastResortReason] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startedAt) {
      setError("Start the call note before saving.");
      return;
    }
    const dueAt = nextActionDueAt ? parseBusinessDate(nextActionDueAt) : null;
    if (nextActionDueAt && !dueAt) {
      setError("Choose a valid next-action date.");
      return;
    }
    if ((nextActionKind && !dueAt) || (!nextActionKind && dueAt)) {
      setError("Choose both a next action and date, or leave both blank.");
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      const result = await onComplete({
        organizationId: organization.id,
        contactId: contact?.id ?? null,
        bookingId: booking?.id ?? null,
        followUpId,
        note,
        disposition,
        resultingBookingStatus: null,
        startedAt,
        endedAt: new Date(),
        nextAction: nextActionKind && dueAt ? { kind: nextActionKind, dueAt } : null,
        lastResortReason: lastResortReason || null,
        approvedContactUpdates: null,
        approvedBookingUpdates: null,
      });
      if (!result.ok) setError(result.error);
    } catch {
      setError("Could not save this call note. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Calls</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Call Workspace</h1>
        <p className="mt-2 text-slate-600">Record this call and its next concrete action.</p>
      </header>

      {organization.lastResort ? (
        <aside className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-950" role="alert">
          <strong>{organization.name} is marked Last Resort.</strong>{" "}
          {organization.lastResortReason || "Review this account before making any new commitments."}
        </aside>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,1fr)] lg:items-start">
        <div className="grid gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="call-details-title">
            <h2 className="text-xl font-bold" id="call-details-title">Record call</h2>
            {!startedAt ? (
              <div className="mt-4">
                <p className="text-sm text-slate-600">Timing starts only when you are ready to record the note.</p>
                <button className="button-primary mt-3" onClick={() => setStartedAt(new Date())} type="button">
                  Start call note
                </button>
              </div>
            ) : (
              <form className="mt-4 grid gap-4" onSubmit={submit}>
                {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
                <label className="grid gap-1.5 font-medium" htmlFor="call-note">
                  Call note
                  <textarea className="min-h-32" id="call-note" onChange={(event) => setNote(event.target.value)} value={note} />
                </label>
                <label className="grid gap-1.5 font-medium" htmlFor="call-disposition">
                  Call disposition
                  <select id="call-disposition" onChange={(event) => setDisposition(event.target.value as CallDisposition)} value={disposition}>
                    {dispositionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4">
                  <legend className="px-1 font-semibold">Next action</legend>
                  <label className="grid gap-1.5 font-medium" htmlFor="next-action">
                    Next action
                    <select id="next-action" onChange={(event) => setNextActionKind(event.target.value)} value={nextActionKind}>
                      <option value="">No next action</option>
                      <option value="call">Call</option>
                      <option value="send_information">Send information</option>
                      <option value="prepare_quote">Prepare quote</option>
                      <option value="check_contract">Check on contract</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 font-medium" htmlFor="next-action-date">
                    Next action date
                    <input id="next-action-date" onChange={(event) => setNextActionDueAt(event.target.value)} type="date" value={nextActionDueAt} />
                  </label>
                </fieldset>
                {disposition === "move_to_last_resort" ? (
                  <label className="grid gap-1.5 font-medium" htmlFor="last-resort-reason">
                    Last Resort reason
                    <textarea id="last-resort-reason" onChange={(event) => setLastResortReason(event.target.value)} value={lastResortReason} />
                  </label>
                ) : null}
                <div><button className="button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : "Save call note"}</button></div>
              </form>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="recent-history-title">
            <h2 className="text-xl font-bold" id="recent-history-title">Recent history</h2>
            <div className="mt-4"><ActivityTimeline activities={timeline} loadRevisions={loadRevisions} /></div>
          </section>
        </div>

        <aside className="grid gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="caller-title">
            <h2 className="text-xl font-bold" id="caller-title">Caller</h2>
            {contact ? <div className="mt-3 grid gap-1 text-sm"><p className="font-semibold text-base">{contact.name}</p><p>{contact.phone || "No phone recorded"}</p><p className="break-all">{contact.email || "No email recorded"}</p><a className="link mt-2" href={`/contacts/${contact.id}`}>Open full contact record</a></div> : <p className="mt-3 text-sm text-slate-600">No contact is linked to this call.</p>}
            <a className="link mt-3 inline-block" href={`/organizations/${organization.id}`}>Open full organization record</a>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="booking-snapshot-title">
            <h2 className="text-xl font-bold" id="booking-snapshot-title">Booking snapshot</h2>
            {booking ? <div className="mt-3 grid gap-1 text-sm"><p className="font-semibold text-base">{booking.name}</p><p>{booking.city}, {booking.region}</p><p className="capitalize">{booking.status.replaceAll("_", " ")}</p><p>{formatDate(booking.startsAt)}</p><a className="link mt-2" href={`/bookings/${booking.id}`}>Open full booking record</a></div> : <p className="mt-3 text-sm text-slate-600">No booking is linked to this call.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
