import Link from "next/link";

import type { FollowUpSummary } from "@/features/follow-ups/today-query";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

export function NextCallCard({ followUp }: { followUp: FollowUpSummary | null }) {
  return (
    <section className="rounded-xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-800">
        Next call
      </p>
      {followUp ? (
        <div className="mt-3">
          <Link
            className="text-xl font-bold text-slate-950 hover:text-orange-800"
            href={`/bookings/${followUp.bookingId}`}
          >
            {followUp.bookingName}
          </Link>
          <p className="mt-1 text-sm text-slate-700">
            Call due {formatDate(followUp.dueAt)}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-700">
          No open calls need attention right now.
        </p>
      )}
    </section>
  );
}
