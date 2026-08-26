import { useState } from "react";
import { Link } from "wouter";

import { FollowUpControls } from "@/components/follow-ups/follow-up-controls";
import { followUpHref } from "@/components/today/next-call-card";
import { BookingOperations } from "@/components/today/booking-operations";
import { deleteFollowUpAction, editFollowUpAction } from "@/actions/follow-ups";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";
import { BUSINESS_TIME_ZONE, classifyBusinessDueDate } from "@/lib/business-date";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: BUSINESS_TIME_ZONE }).format(value);
}

function formatKind(value: string) {
  return value.replaceAll("_", " ");
}

export function FollowUpList({ followUps, now }: { followUps: FollowUpSummary[]; now: Date }) {
  const [items, setItems] = useState(followUps);
  const overdueCount = items.filter((followUp) => classifyBusinessDueDate(followUp.dueAt, now) === "overdue").length;

  return (
    <section id="follow-ups" aria-label="Outreach and follow-up queue" className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Outreach & follow-ups</h2>
          <p className="mt-1 text-sm text-slate-600">Call, email, or use the event website. Work straight down the queue; overdue items stay first.</p>
        </div>
        {overdueCount ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">{overdueCount} overdue</span> : null}
      </div>

      {items.length ? (
        <ol className="mt-4 grid gap-2">
          {items.map((followUp) => {
            const overdue = classifyBusinessDueDate(followUp.dueAt, now) === "overdue";
            const contactSheetHref = followUpHref(followUp);
            return (
              <li className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-start sm:justify-between" key={followUp.id}>
                <div className="min-w-0 flex-1">
                  <Link className="font-bold text-slate-950 hover:text-orange-700" href={contactSheetHref}>{followUp.bookingName}</Link>
                  <p className="mt-0.5 text-sm capitalize text-slate-600">{formatKind(followUp.kind)}</p>
                  <BookingOperations operations={followUp.operations} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link className="button-secondary" href={contactSheetHref}>Email</Link>
                    <Link className="button-secondary" href={contactSheetHref}>Web contact</Link>
                  </div>
                  <FollowUpControls
                    followUp={{ id: followUp.id, kind: followUp.kind, dueAt: followUp.dueAt, completedAt: null }}
                    onEdit={async (id, input) => {
                      const result = await editFollowUpAction({ followUpId: id, kind: input.kind, dueAt: new Date(input.dueAt), completed: false, outcome: null });
                      if (result.ok) setItems((current) => current.map((f) => f.id === id ? { ...f, kind: result.followUp.kind, dueAt: result.followUp.dueAt } : f));
                      return result;
                    }}
                    onSkip={(id) => {
                      setItems((current) => current.filter((f) => f.id !== id));
                    }}
                    onDismiss={async (id) => {
                      const target = items.find((f) => f.id === id);
                      if (!target) return { ok: false, error: "Follow-up not found." };
                      const result = await editFollowUpAction({ followUpId: id, kind: target.kind, dueAt: target.dueAt, completed: true, outcome: "Dismissed" });
                      if (result.ok) setItems((current) => current.filter((f) => f.id !== id));
                      return result;
                    }}
                    onDelete={async (id) => {
                      const result = await deleteFollowUpAction(id);
                      if (result.ok) setItems((current) => current.filter((f) => f.id !== id));
                      return result;
                    }}
                  />
                </div>
                <p className={`shrink-0 text-sm font-semibold ${overdue ? "text-rose-700" : "text-slate-700"}`}>{overdue ? "Overdue" : "Due"} {formatDate(followUp.dueAt)}</p>
              </li>
            );
          })}
        </ol>
      ) : <p className="mt-4 text-sm text-slate-600">No open outreach or follow-ups.</p>}
    </section>
  );
}
