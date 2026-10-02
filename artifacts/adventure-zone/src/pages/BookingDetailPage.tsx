import { BookingLegOperationsCard } from '@/components/bookings/leg-operations-panel';
import { ownerOperationsClient } from '@/features/bookings/booking-leg-operations-client';
import { useBookingOperationsRevision } from '@/features/bookings/booking-operations-changes';
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { FollowUpCompletionDialog } from "@/components/bookings/follow-up-completion-dialog";
import { BookingCalendarSendButton } from "@/components/bookings/booking-calendar-send-button";
import { PackageHistorySignals } from "@/components/bookings/package-history-signals";
import { BookingBriefCard } from "@/components/assistant/booking-brief-card";
import { AssistantContextRegistration } from "@/components/assistant/assistant-context-registration";
import { StatusBadge } from "@/components/bookings/status-badge";
import { LastResortWarning } from "@/components/organizations/last-resort-warning";
import { ContractAction } from "@/components/contracts/contract-action";
import { ContractHistoryCard } from "@/components/contracts/contract-history-card";
import { contractClient } from "@/features/contracts/contract-client";
import type { ContractVersion } from "@/features/contracts/contract-types";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";
import { getAssistantContext, getBookingBrief } from "@/features/assistant/assistant-api";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import type {
  AssistantContextBundle,
  BookingBrief,
} from "@/features/assistant/assistant-types";
import {
  createActivityAction,
  deleteActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
} from "@/actions/activities";
import { completeFollowUpAction } from "@/actions/bookings";
import { deleteFollowUpAction, editFollowUpAction } from "@/actions/follow-ups";
import { FollowUpControls } from "@/components/follow-ups/follow-up-controls";
import type { ReactNode } from "react";
import { InvoiceContractSummaryCard } from "@/components/invoices/invoice-contract-summary-card";
import { contractsWorkspaceApi, invoicesApi } from "@/lib/invoices-api";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}
function money(cents: number | null | undefined) {
  if (cents == null) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
function cashDifference(cents: number | null | undefined) {
  if (cents == null) return null;
  if (cents === 0) return "Cash balanced";
  return `${money(Math.abs(cents))} ${cents < 0 ? "short" : "over"}`;
}

export function coerceBookingDetailPayload(d: any) {
  return {
    ...d,
    timeline: (d.timeline ?? []).map((item: any) => ({
      ...item,
      occurredAt: item.occurredAt ? new Date(item.occurredAt) : item.occurredAt,
      createdAt: item.createdAt ? new Date(item.createdAt) : item.createdAt,
      updatedAt: item.updatedAt ? new Date(item.updatedAt) : item.updatedAt,
    })),
  };
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-sm font-semibold text-slate-500">{item.label}</dt>
          <dd className="mt-0.5 text-slate-900">
            {item.value == null || item.value === "" ? "Not set" : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function BookingDetailPage({ bookingId }: { bookingId: string }) {
  const { openAssistant } = useAssistantContext();
  const [data, setData] = useState<any>(null);
  const [wrapUp, setWrapUp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followUpItems, setFollowUpItems] = useState<any[]>([]);
  const [assistantBundle, setAssistantBundle] = useState<AssistantContextBundle | null>(null);
  const [bookingBrief, setBookingBrief] = useState<BookingBrief | null>(null);
  const [contractBooking, setContractBooking] = useState<{ id: string; name: string; openDraftId: string | null } | null>(null);
  const [contractVersions, setContractVersions] = useState<ContractVersion[]>([]);
  const revision = useBookingOperationsRevision(bookingId);

  useEffect(() => {
    let active = true;
    setError(null);
    Promise.all([
      apiGet<any>(`/bookings/${bookingId}`),
      apiGet<any>(`/event-wrap-up-admin/${bookingId}`).catch(() => null),
    ])
      .then(([raw, wrap]) => {
        if (!active) return;
        const d = coerceBookingDetailPayload(raw);
        setData(d);
        setWrapUp(wrap?.wrapUp ? wrap : null);
        setFollowUpItems(d.followUps ?? []);
        setLoading(false);
      })
      .catch((e) => { if (active) { setError(e.message); setLoading(false); } });
    return () => { active = false; };
  }, [bookingId, revision]);

  useEffect(() => {
    const context = {
      kind: "booking" as const,
      recordId: bookingId,
      label: data?.booking?.name ?? "Booking",
    };
    let cancelled = false;
    Promise.all([
      getAssistantContext(context),
      getBookingBrief(context),
    ])
      .then(([bundle, brief]) => {
        if (cancelled) return;
        setAssistantBundle(bundle);
        setBookingBrief(brief);
      })
      .catch(() => {
        if (cancelled) return;
        setAssistantBundle(null);
        setBookingBrief(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId, data?.booking?.name]);

  useEffect(() => {
    const organizationId = data?.organization?.id;
    if (!organizationId) return;
    let cancelled = false;
    contractClient.listOrganization(organizationId).then((result) => {
      if (cancelled) return;
      const choice = result.eligibleBookings.find((booking) => booking.id === bookingId);
      setContractBooking(choice ?? { id: bookingId, name: data.booking.name, openDraftId: null });
      setContractVersions(result.contracts.filter((contract) => contract.bookingId === bookingId));
    }).catch(() => setContractBooking(null));
    return () => { cancelled = true; };
  }, [bookingId, data?.booking?.name, data?.organization?.id]);

  if (loading) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-slate-500">Loading booking…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  const { booking, organization, contact, travelLeg, timeline, packageHistoryComparison } = data;
  const nextFollowUp = followUpItems.find((f: any) => !f.completedAt) ?? null;
  const difference = cashDifference(wrapUp?.calculation?.settlement?.differenceCents);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <AssistantContextRegistration kind="booking" label={booking.name ?? "Booking"} recordId={bookingId} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{booking.name}</h1>
            <StatusBadge status={booking.status} />
          </div>
          <p className="mt-1 text-slate-600">{booking.city}, {booking.region}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {contractBooking ? <ContractAction bookingId={bookingId} bookings={[contractBooking]} /> : null}
          <BookingCalendarSendButton bookingId={bookingId} />
          <button
            className="button-secondary"
            onClick={() => openAssistant("What should I know before I contact them?")}
            type="button"
          >
            Ask Assistant
          </button>
          <Link className="button-primary text-center" href={`/bookings/${bookingId}/edit`}>
            Edit booking
          </Link>
        </div>
      </header>

      {organization?.lastResort && (
        <LastResortWarning
          organizationName={organization.name}
          reason={organization.lastResortReason ?? ""}
        />
      )}

      {contractVersions.length ? <section className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-lg font-bold">Contract history</h2>
        {contractVersions.map((contract) => <ContractHistoryCard key={contract.id} version={contract} />)}
      </section> : null}

      <InvoiceContractSummaryCard bookingId={bookingId} contractApi={contractsWorkspaceApi} invoiceApi={invoicesApi} />
      <BookingLegOperationsCard bookingId={bookingId} client={ownerOperationsClient} role="owner" />

      {bookingBrief ? (
        <BookingBriefCard brief={bookingBrief} context={assistantBundle} />
      ) : null}

      {wrapUp ? <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Event wrap-up</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold capitalize">{wrapUp.wrapUp.status}</span>
              {wrapUp.wrapUp.ratingStars != null ? <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800">{"★".repeat(wrapUp.wrapUp.ratingStars)} {wrapUp.wrapUp.ratingStars}/5</span> : null}
              {difference && difference !== "Cash balanced" ? <span className="rounded-full bg-rose-50 px-3 py-1 font-semibold text-rose-700">{difference}</span> : null}
            </div>
            <p className="mt-3 text-sm"><b>Direct profit:</b> {money(wrapUp.calculation?.directProfit?.profitCents)} · <b>Estimated true profit:</b> {wrapUp.calculation?.trueProfit?.profitCents == null ? "Unavailable" : money(wrapUp.calculation.trueProfit.profitCents)}</p>
          </div>
          <a className="button-secondary" href={`/manager-aftermath?wrapUp=${encodeURIComponent(bookingId)}`}>Review wrap-up</a>
        </div>
      </section> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <DetailSection title="Details">
          <DetailList
            items={[
              { label: "Dates", value: `${formatDate(booking.startsAt)} – ${formatDate(booking.endsAt)}` },
              { label: "Venue", value: booking.venueName },
              { label: "City", value: `${booking.city}, ${booking.region}` },
              { label: "Probability", value: booking.probability },
              { label: "Travel leg", value: travelLeg?.name },
            ]}
          />
        </DetailSection>

        <DetailSection title="Contacts">
          {contact ? (
            <Link className="link" href={`/contacts/${contact.id}`}>
              {contact.firstName} {contact.lastName}
            </Link>
          ) : (
            <p className="text-sm text-slate-500">No contact assigned</p>
          )}
        </DetailSection>
      </div>

      <PackageHistorySignals comparison={packageHistoryComparison} />

      {followUpItems.length > 0 && (
        <DetailSection title="Follow-up plan">
          <ul className="grid gap-3">
            {followUpItems.map((followUp: any) => (
              <li className="rounded-lg border border-slate-100 p-3 text-sm" key={followUp.id}>
                <p className="font-semibold capitalize">
                  {String(followUp.kind).replaceAll("_", " ")}
                </p>
                <p className="text-slate-600">
                  {followUp.completedAt
                    ? `Completed ${formatDate(followUp.completedAt)}`
                    : `Due ${formatDate(followUp.dueAt)}`}
                </p>
                {followUp.outcome ? (
                  <p className="mt-1 text-slate-700">Outcome: {followUp.outcome}</p>
                ) : null}
                <FollowUpControls
                  followUp={{
                    id: followUp.id,
                    kind: followUp.kind,
                    dueAt: new Date(followUp.dueAt),
                    completedAt: followUp.completedAt ? new Date(followUp.completedAt) : null,
                  }}
                  onEdit={async (id, input) => {
                    const result = await editFollowUpAction({ followUpId: id, kind: input.kind, dueAt: new Date(input.dueAt), completed: false, outcome: null });
                    if (result.ok) {
                      setFollowUpItems((items) =>
                        items.map((f) =>
                          f.id === id
                            ? { ...f, kind: result.followUp.kind, dueAt: result.followUp.dueAt }
                            : f,
                        ),
                      );
                    }
                    return result;
                  }}
                  onDelete={async (id) => {
                    const result = await deleteFollowUpAction(id);
                    if (result.ok) setFollowUpItems((items) => items.filter((f) => f.id !== id));
                    return result;
                  }}
                />
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      {nextFollowUp && (
        <FollowUpCompletionDialog
          bookingStatus={booking.status}
          followUpId={nextFollowUp.id}
          onComplete={completeFollowUpAction}
        />
      )}

      <ActivityTimeline
        activities={timeline ?? []}
        parent={{ bookingId }}
        createActivity={createActivityAction}
        deleteActivity={deleteActivityAction}
        editActivity={editActivityAction}
        loadRevisions={listActivityRevisionsAction}
      />
    </div>
  );
}
