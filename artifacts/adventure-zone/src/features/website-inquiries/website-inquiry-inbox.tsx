import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { WebsiteInquiryApi } from "./website-inquiry-api";
import { WebsiteInquiryDetail } from "./website-inquiry-detail";
import type { WebsiteInquiryListItem, WebsiteInquiryStatus } from "./types";

const filters: Array<{ value: WebsiteInquiryStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "converted", label: "Converted" },
  { value: "archived", label: "Archived" },
  { value: "spam", label: "Spam" },
];

function initialInquiryId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("inquiry");
}

function updateInquiryQuery(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("inquiry", id);
  else url.searchParams.delete("inquiry");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function friendlyDate(value: string | null): string {
  if (!value) return "Date not provided";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function WebsiteInquiryInbox({ api }: { api: WebsiteInquiryApi }) {
  const [status, setStatus] = useState<WebsiteInquiryStatus>("new");
  const [selectedId, setSelectedId] = useState<string | null>(initialInquiryId);
  const list = useQuery({
    queryKey: ["website-inquiries", status],
    queryFn: () => api.get<{ items: WebsiteInquiryListItem[]; nextCursor: string | null }>(
      `/website-inquiries?status=${status}&limit=25`,
    ),
  });
  const count = useQuery({
    queryKey: ["website-inquiry-count"],
    queryFn: () => api.get<{ newCount: number }>("/website-inquiries/count"),
    refetchInterval: 15_000,
  });
  const items = [...(list.data?.items ?? [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );

  function select(id: string | null) {
    setSelectedId(id);
    updateInquiryQuery(id);
  }

  return (
    <div className="mx-auto max-w-7xl pb-12">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Booking workspace</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Website inquiries</h1>
          <p className="mt-2 max-w-2xl text-slate-600">Review messages from the public website, check possible CRM matches, and choose what becomes a booking lead.</p>
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-center">
          <span className="block text-2xl font-black text-orange-800">{count.data?.newCount ?? "—"}</span>
          <span className="text-xs font-bold uppercase tracking-wide text-orange-700">New</span>
        </div>
      </header>

      <nav aria-label="Inquiry status filters" className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {filters.map((filter) => (
          <button
            aria-pressed={status === filter.value}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${status === filter.value ? "bg-slate-950 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
            key={filter.value}
            onClick={() => { setStatus(filter.value); setSelectedId(null); }}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(22rem,0.8fr)_minmax(32rem,1.3fr)]">
        <section aria-label={`${status} inquiry list`}>
          {list.isLoading ? <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600" role="status">Loading inquiries…</div> : null}
          {list.isError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5" role="alert">
              <p className="text-sm font-semibold text-rose-900">Could not load website inquiries.</p>
              <button className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-bold text-rose-900" onClick={() => void list.refetch()} type="button">Retry</button>
            </div>
          ) : null}
          {!list.isLoading && !list.isError && items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">No {status} inquiries.</p>
          ) : null}
          {items.length ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table aria-label="Website inquiries" className="w-full border-collapse">
                <thead className="sr-only"><tr><th>Inquiry</th></tr></thead>
                <tbody>
                  {items.map((item) => (
                    <tr className="border-b border-slate-100 last:border-0" key={item.id}>
                      <td>
                        <button
                          aria-pressed={selectedId === item.id}
                          className={`block w-full p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 ${selectedId === item.id ? "bg-orange-50" : "hover:bg-slate-50"}`}
                          onClick={() => select(item.id)}
                          type="button"
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span>
                              <span className="block font-bold text-slate-950">{item.name}</span>
                              <span className="mt-0.5 block text-sm font-semibold text-slate-700">{item.eventName}</span>
                            </span>
                            <span className="text-xs font-semibold text-slate-500">{friendlyDate(item.createdAt)}</span>
                          </span>
                          <span className="mt-2 block text-xs text-slate-600">{item.eventLocation ?? "Location not provided"} · {item.referenceCode}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section aria-label="Selected inquiry">
          {selectedId ? (
            <WebsiteInquiryDetail
              api={api}
              inquiryId={selectedId}
              onChanged={() => void list.refetch()}
              onClose={() => select(null)}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">Select an inquiry to read its complete message and review possible matches.</div>
          )}
        </section>
      </div>
    </div>
  );
}
