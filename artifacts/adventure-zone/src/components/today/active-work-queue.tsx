import { useState, type DragEvent } from "react";
import { Link } from "wouter";

import type { MasterWorkItem } from "@/features/today/master-work-types";

function profileHref(item: MasterWorkItem): string {
  if (!item.organizationId) return "/today";
  const params = new URLSearchParams({ from: "today", workItemId: item.id });
  if (item.bookingId) params.set("bookingId", item.bookingId);
  if (item.contactId) params.set("contactId", item.contactId);
  return `/event-profiles/${item.organizationId}?${params.toString()}`;
}

export function ActiveWorkQueue({
  items,
  busy,
  onOpen,
  onPin,
  onUrgent,
  onSnooze,
  onReorder,
  onReset,
}: {
  items: MasterWorkItem[];
  busy: boolean;
  onOpen: (item: MasterWorkItem, filter: string) => void;
  onPin: (item: MasterWorkItem) => void;
  onUrgent: (item: MasterWorkItem) => void;
  onSnooze: (item: MasterWorkItem) => void;
  onReorder: (opportunityIds: string[]) => void;
  onReset: () => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  function dropOn(target: MasterWorkItem, event: DragEvent) {
    event.preventDefault();
    if (!draggedId || draggedId === target.id) return;
    const ordered = [...items];
    const from = ordered.findIndex(({ id }) => id === draggedId);
    const to = ordered.findIndex(({ id }) => id === target.id);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    if (!moved) return;
    ordered.splice(to, 0, moved);
    const opportunityIds = ordered.flatMap(({ opportunityId }) =>
      opportunityId ? [opportunityId] : [],
    );
    if (opportunityIds.length) onReorder(opportunityIds);
    setDraggedId(null);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="active-queue-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold" id="active-queue-title">Active Queue</h2>
          <p className="text-sm text-slate-500">Smart order, with your daily overrides.</p>
        </div>
        <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold" type="button" disabled={busy} onClick={onReset}>Reset to smart order</button>
      </div>
      {!items.length ? <p className="mt-3 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">No active Booking work right now.</p> : null}
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <article
            key={item.id}
            draggable={Boolean(item.opportunityId) && !busy}
            onDragStart={() => setDraggedId(item.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropOn(item, event)}
            className="rounded-xl border border-slate-200 p-3"
            data-work-item-id={item.id}
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                href={profileHref(item)}
                data-master-work="true"
                onClick={() => onOpen(item, "active")}
                className="min-w-0 flex-1"
              >
                <p className="truncate font-bold text-slate-950">{item.eventName}</p>
                <p className="text-sm text-slate-600">{[item.city, item.region].filter(Boolean).join(", ") || "Location not set"}</p>
                <p className="mt-1 text-sm font-semibold text-orange-700">{item.reason}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                  <span>{item.kind.replaceAll("_", " ")}</span>
                  {item.opportunityStatus ? <span>• {item.opportunityStatus.replaceAll("_", " ")}</span> : null}
                  {item.dueAt ? <span>• {new Date(item.dueAt).toLocaleDateString()}</span> : null}
                </div>
              </Link>
              <span className="cursor-grab select-none text-lg text-slate-400" aria-label="Drag to reorder">⋮⋮</span>
            </div>
            {item.opportunityId ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => onPin(item)} className="rounded-lg border px-3 py-2 text-xs font-bold">{item.pinned ? "Unpin" : "Pin"}</button>
                <button type="button" disabled={busy} onClick={() => onUrgent(item)} className="rounded-lg border px-3 py-2 text-xs font-bold">{item.priority === "urgent" ? "Normal priority" : "Urgent"}</button>
                <button type="button" disabled={busy} onClick={() => onSnooze(item)} className="rounded-lg border px-3 py-2 text-xs font-bold">Snooze 1 day</button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
