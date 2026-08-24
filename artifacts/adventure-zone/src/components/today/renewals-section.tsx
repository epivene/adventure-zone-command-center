import { useState } from "react";
import { Link } from "wouter";

import { BookingOperations } from "@/components/today/booking-operations";
import { eventProfileHref } from "@/components/today/next-call-card";
import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

export type RenewalSectionItem = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  status: string;
  followUpId: string | null;
  dueAt: Date | null;
  attention: "overdue" | "soon" | "later" | "needs_plan";
  operations?: BookingOperationsSummary | null;
};

type RenewalsSectionProps = {
  renewals: RenewalSectionItem[];
  total: number;
  prominentCount: number;
  error: string | null;
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

function pluralizeRenewal(count: number) {
  return count === 1 ? "renewal" : "renewals";
}

function attentionBadge(item: RenewalSectionItem) {
  if (item.attention === "overdue") return "Overdue";
  if (item.attention === "soon") return "Within 30 days";
  if (item.attention === "needs_plan") return "Needs renewal plan";
  return null;
}

export function RenewalsSection({
  renewals,
  total,
  prominentCount,
  error,
}: RenewalsSectionProps) {
  const [open, setOpen] = useState(false);
  const overdueCount = renewals.filter(
    ({ attention }) => attention === "overdue",
  ).length;
  const soonCount = renewals.filter(({ attention }) => attention === "soon").length;
  const attentionCount = overdueCount + soonCount;
  const attentionCopy =
    overdueCount > 0
      ? `${attentionCount} ${pluralizeRenewal(attentionCount)} ${
          attentionCount === 1 ? "needs" : "need"
        } attention`
      : soonCount > 0
        ? `${soonCount} ${pluralizeRenewal(soonCount)} coming up soon`
        : null;

  return (
    <section
      className={
        prominentCount > 0
          ? "rounded-xl border border-orange-200 bg-orange-50 p-5 shadow-sm"
          : "rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      }
      aria-labelledby="today-renewals-title"
    >
      <button
        aria-expanded={open}
        aria-controls="today-renewals-content"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="text-xl font-bold" id="today-renewals-title">
          Next Season / Renewals ({total})
        </span>
        <span aria-hidden className="text-2xl leading-none text-slate-500">
          {open ? "−" : "+"}
        </span>
      </button>

      {attentionCopy ? (
        <p className="mt-1 text-sm font-semibold text-orange-800">
          {attentionCopy}
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-600">
          Future-season work stays tucked away until it gets close.
        </p>
      )}

      {error ? (
        <p
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {open ? (
        <div className="mt-4" id="today-renewals-content">
          {renewals.length ? (
            <ul className="grid gap-3">
              {renewals.map((item) => {
                const badge = attentionBadge(item);
                const href =
                  eventProfileHref({
                    organizationId: item.organizationId,
                    contactId: item.primaryContactId,
                    bookingId: item.id,
                    followUpId: item.followUpId,
                    action: item.followUpId ? "follow-up" : undefined,
                  }) ?? `/bookings/${item.id}`;

                return (
                  <li
                    className="rounded-lg border border-slate-200 bg-white p-3"
                    key={item.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Link
                          className="font-semibold text-slate-950 hover:text-orange-700"
                          href={href}
                        >
                          {item.name}
                        </Link>
                        <p className="mt-1 text-sm capitalize text-slate-600">
                          {item.status.replaceAll("_", " ")}
                        </p>
                      </div>
                      {badge ? (
                        <span
                          className={
                            item.attention === "overdue"
                              ? "rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800"
                              : item.attention === "soon"
                                ? "rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-800"
                                : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
                          }
                        >
                          {badge}
                        </span>
                      ) : null}
                    </div>

                    {item.dueAt ? (
                      <p className="mt-2 text-sm text-slate-700">
                        Follow-up {formatDate(item.dueAt)}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm font-medium text-slate-700">
                        Schedule the next-season follow-up when you are ready.
                      </p>
                    )}

                    <BookingOperations operations={item.operations} />
                  </li>
                );
              })}
            </ul>
          ) : error ? null : (
            <p className="text-sm text-slate-600">
              No next-season renewals are waiting right now.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
