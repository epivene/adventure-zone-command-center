import { Link } from "wouter";

import type { MasterWorkItem } from "@/features/today/master-work-types";

function profileHref(item: MasterWorkItem): string {
  if (!item.organizationId) return "/today";
  const params = new URLSearchParams({ from: "today", workItemId: item.id });
  if (item.bookingId) params.set("bookingId", item.bookingId);
  if (item.contactId) params.set("contactId", item.contactId);
  return `/event-profiles/${item.organizationId}?${params.toString()}`;
}

export function NeedsAttentionSection({
  items,
  onOpen,
}: {
  items: MasterWorkItem[];
  onOpen: (item: MasterWorkItem, filter: string) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 shadow-sm" aria-labelledby="needs-attention-title">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-rose-950" id="needs-attention-title">Needs Attention</h2>
        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">{items.length}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={profileHref(item)}
            data-master-work="true"
            data-work-item-id={item.id}
            onClick={() => onOpen(item, "needs-attention")}
            className="rounded-xl border border-rose-200 bg-white p-3 hover:border-rose-400"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-950">{item.eventName}</p>
                <p className="text-sm text-slate-600">{[item.city, item.region].filter(Boolean).join(", ") || "Location not set"}</p>
                <p className="mt-1 text-sm font-semibold text-rose-800">{item.reason}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize text-slate-700">{item.kind.replaceAll("_", " ")}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
