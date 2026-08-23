import { Link } from "wouter";

import type { FollowUpSummary } from "@/features/follow-ups/today-query";
import { BookingOperations } from "@/components/today/booking-operations";
import {
  CopilotReason,
  type BookingCopilotReason,
} from "@/components/today/copilot-reason";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

export function callWorkspaceHref(followUp: FollowUpSummary) {
  const parameters = new URLSearchParams();
  if (followUp.contactId) parameters.set("contactId", followUp.contactId);
  if (followUp.bookingId) parameters.set("bookingId", followUp.bookingId);
  parameters.set("followUpId", followUp.id);
  return `/calls/workspace?${parameters.toString()}`;
}

type EventProfileLinkContext = {
  organizationId: string | null;
  contactId?: string | null;
  bookingId?: string | null;
  followUpId?: string | null;
  action?: "call" | "follow-up";
  mode?: "prospect";
};

export function eventProfileHref(context: EventProfileLinkContext) {
  if (!context.organizationId) return null;
  const parameters = new URLSearchParams();
  if (context.contactId) parameters.set("contactId", context.contactId);
  if (context.bookingId) parameters.set("bookingId", context.bookingId);
  if (context.followUpId) parameters.set("followUpId", context.followUpId);
  if (context.action) parameters.set("action", context.action);
  if (context.mode) parameters.set("mode", context.mode);
  const query = parameters.toString();
  return `/profiles/${context.organizationId}${query ? `?${query}` : ""}`;
}

export function followUpHref(followUp: FollowUpSummary) {
  const profileHref = eventProfileHref({
    organizationId: followUp.organizationId,
    contactId: followUp.contactId,
    bookingId: followUp.bookingId,
    followUpId: followUp.id,
    action: "follow-up",
  });
  if (profileHref) return profileHref;
  if (followUp.kind === "call") return callWorkspaceHref(followUp);
  if (followUp.bookingId) return `/bookings/${followUp.bookingId}`;
  if (followUp.contactId) return `/contacts/${followUp.contactId}`;
  return followUp.organizationId ? `/profiles/${followUp.organizationId}` : "/profiles";
}

type CopilotFollowUp = FollowUpSummary & { copilot?: BookingCopilotReason | null };

export function NextCallCard({ followUp }: { followUp: CopilotFollowUp | null }) {
  const profileHref = followUp
    ? eventProfileHref({
        organizationId: followUp.organizationId,
        contactId: followUp.contactId,
        bookingId: followUp.bookingId,
        followUpId: followUp.id,
        action: "call",
      })
    : null;

  return (
    <section className="rounded-2xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-950">Up Next</h2>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-orange-800 shadow-sm">Next action</span>
      </div>
      {followUp ? (
        <div className="mt-4">
          <Link className="text-xl font-bold text-slate-950 hover:text-orange-800" href={profileHref ?? callWorkspaceHref(followUp)}>{followUp.bookingName}</Link>
          <p className="mt-1 text-sm text-slate-700">Call due {formatDate(followUp.dueAt)}</p>
          <CopilotReason copilot={followUp.copilot} />
          <BookingOperations operations={followUp.operations} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="button-primary" href={profileHref ?? callWorkspaceHref(followUp)}>Open</Link>
            <Link className="button-secondary" href="/calls/workspace">Call workspace</Link>
          </div>
        </div>
      ) : <p className="mt-3 text-sm text-slate-700">No open calls need attention right now.</p>}
    </section>
  );
}
