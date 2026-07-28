import Link from "next/link";

import { followUpHref } from "@/components/today/next-call-card";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";
import {
  BUSINESS_TIME_ZONE,
  classifyBusinessDueDate,
} from "@/lib/business-date";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

function formatKind(value: string) {
  return value.replaceAll("_", " ");
}

export function FollowUpList({
  followUps,
  now,
}: {
  followUps: FollowUpSummary[];
  now: Date;
}) {
  const overdueCount = followUps.filter(
    (followUp) =>
      classifyBusinessDueDate(followUp.dueAt, now) === "overdue",
  ).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Overdue follow-ups</h2>
          <p className="mt-1 text-sm text-slate-600">
            {overdueCount
              ? `${overdueCount} need attention before the next call.`
              : "No overdue calls. The next actions remain prioritized below."}
          </p>
        </div>
        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">
          {overdueCount} overdue
        </span>
      </div>

      {followUps.length ? (
        <ol className="mt-4 grid gap-3">
          {followUps.map((followUp) => {
            const overdue =
              classifyBusinessDueDate(followUp.dueAt, now) === "overdue";
            return (
              <li
                className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                key={followUp.id}
              >
                <div>
                  <Link
                    className="font-bold text-slate-950 hover:text-orange-700"
                    href={followUpHref(followUp)}
                  >
                    {followUp.bookingName}
                  </Link>
                  <p className="mt-0.5 text-sm capitalize text-slate-600">
                    {formatKind(followUp.kind)}
                  </p>
                </div>
                <p
                  className={`text-sm font-semibold ${
                    overdue ? "text-rose-700" : "text-slate-700"
                  }`}
                >
                  {overdue ? "Overdue" : "Due"} {formatDate(followUp.dueAt)}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-slate-600">No open follow-ups.</p>
      )}
    </section>
  );
}
