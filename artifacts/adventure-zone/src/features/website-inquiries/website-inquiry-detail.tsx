import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { WebsiteInquiryApi } from "./website-inquiry-api";
import { WebsiteInquiryConvertDialog } from "./website-inquiry-convert-dialog";
import type {
  WebsiteInquiryDetailResponse,
  WebsiteInquiryMatches,
  WebsiteInquiryStatus,
} from "./types";

const emptyMatches: WebsiteInquiryMatches = {
  contacts: [],
  organizations: [],
  parsedLocation: null,
};

function dateTime(value: string | null): string {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function WebsiteInquiryDetail({
  api,
  inquiryId,
  onChanged,
  onClose,
}: {
  api: WebsiteInquiryApi;
  inquiryId: string;
  onChanged: () => void;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const detail = useQuery({
    queryKey: ["website-inquiry", inquiryId],
    queryFn: () => api.get<WebsiteInquiryDetailResponse>(`/website-inquiries/${inquiryId}`),
  });
  const matches = useQuery({
    queryKey: ["website-inquiry-matches", inquiryId],
    queryFn: () => api.get<WebsiteInquiryMatches>(`/website-inquiries/${inquiryId}/matches`),
  });

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["website-inquiries"] }),
      queryClient.invalidateQueries({ queryKey: ["website-inquiry", inquiryId] }),
      queryClient.invalidateQueries({ queryKey: ["website-inquiry-matches", inquiryId] }),
      queryClient.invalidateQueries({ queryKey: ["website-inquiry-count"] }),
    ]);
    onChanged();
  }

  async function changeStatus(action: "begin_review" | "archive" | "spam" | "restore", label: string) {
    if (saving) return;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.patch(`/website-inquiries/${inquiryId}/status`, { action });
      setFeedback(label);
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The inquiry could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  if (detail.isLoading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-5" role="status">Loading inquiry details…</div>;
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5" role="alert">
        <p>Could not load this inquiry.</p>
        <button className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-2 font-semibold" onClick={() => void detail.refetch()} type="button">Retry detail</button>
      </div>
    );
  }

  const inquiry = detail.data.inquiry;
  const status = inquiry.status as WebsiteInquiryStatus;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">{inquiry.referenceCode}</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-950">{inquiry.eventName}</h2>
            <p className="mt-1 text-sm text-slate-600">Received {dateTime(inquiry.createdAt)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">{titleCase(status)}</span>
            {onClose ? <button aria-label="Close inquiry detail" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={onClose} type="button">Close</button> : null}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {status === "new" ? <button className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white" disabled={saving} onClick={() => void changeStatus("begin_review", "Inquiry moved to reviewing.")} type="button">Begin review</button> : null}
          {status === "new" || status === "reviewing" ? (
            <>
              <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white" disabled={saving} onClick={() => setConverting(true)} type="button">Convert to booking</button>
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" disabled={saving} onClick={() => void changeStatus("archive", "Inquiry archived.")} type="button">Archive</button>
              <button className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800" disabled={saving} onClick={() => void changeStatus("spam", "Inquiry marked as spam.")} type="button">Mark as spam</button>
            </>
          ) : null}
          {status === "archived" || status === "spam" ? <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white" disabled={saving} onClick={() => void changeStatus("restore", "Inquiry restored to new.")} type="button">Restore</button> : null}
        </div>
        {feedback ? <p aria-live="polite" className="mt-3 text-sm font-semibold text-emerald-800" role="status">{feedback}</p> : null}
        {error ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-900" role="alert">{error}</p> : null}
      </header>

      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <div className="grid gap-5">
          <section>
            <h3 className="font-bold text-slate-950">Public contact details</h3>
            <dl className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              <div><dt className="text-xs font-bold uppercase text-slate-500">Name</dt><dd className="mt-1 text-sm text-slate-900">{inquiry.name}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-slate-500">Email</dt><dd className="mt-1 text-sm"><a className="text-orange-800 underline" href={`mailto:${inquiry.email}`}>{inquiry.email}</a></dd></div>
              <div><dt className="text-xs font-bold uppercase text-slate-500">Date</dt><dd className="mt-1 text-sm text-slate-900">{inquiry.eventDate ?? "Not provided"}</dd></div>
              <div><dt className="text-xs font-bold uppercase text-slate-500">Location</dt><dd className="mt-1 text-sm text-slate-900">{inquiry.eventLocation ?? "Not provided"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs font-bold uppercase text-slate-500">Package interest</dt><dd className="mt-1 text-sm text-slate-900">{inquiry.packageInterest ?? "Not provided"}</dd></div>
            </dl>
          </section>
          <section>
            <h3 className="font-bold text-slate-950">Message</h3>
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 p-4 text-sm leading-6 text-slate-800">{inquiry.message}</p>
          </section>

          {status === "converted" ? (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <h3 className="font-bold text-emerald-950">CRM records</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {inquiry.convertedContactId ? <a className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-emerald-900" href={`/contacts/${inquiry.convertedContactId}`}>Open contact</a> : null}
                {inquiry.convertedOrganizationId ? <a className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-emerald-900" href={`/profiles/${inquiry.convertedOrganizationId}`}>Open profile</a> : null}
                {inquiry.convertedBookingId ? <a className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-emerald-900" href={`/bookings/${inquiry.convertedBookingId}`}>Open booking</a> : null}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="grid content-start gap-5">
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-bold text-slate-950">Alert {titleCase(inquiry.alertState)}</h3>
            <p className="mt-1 text-sm text-slate-600">{inquiry.alertAttemptCount} delivery attempt{inquiry.alertAttemptCount === 1 ? "" : "s"}</p>
            {inquiry.alertFailureReason ? <p className="mt-2 text-sm text-rose-800">{inquiry.alertFailureReason}</p> : null}
          </section>
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-bold text-slate-950">Profile match suggestions</h3>
            {matches.isLoading ? <p className="mt-2 text-sm text-slate-500">Finding possible matches…</p> : null}
            {matches.isError ? <p className="mt-2 text-sm text-rose-800">Suggestions are unavailable. Conversion still requires a manual choice.</p> : null}
            {[...(matches.data?.contacts ?? []), ...(matches.data?.organizations ?? [])].map((candidate) => (
              <div className="mt-3 rounded-lg bg-slate-50 p-3" key={candidate.id}>
                <p className="text-sm font-bold text-slate-900">{candidate.label}</p>
                <p className="mt-1 text-xs text-slate-600">{candidate.reasons.join(" · ")}</p>
              </div>
            ))}
            {!matches.isLoading && !matches.isError && (matches.data?.contacts.length ?? 0) + (matches.data?.organizations.length ?? 0) === 0 ? <p className="mt-2 text-sm text-slate-600">No strong existing matches.</p> : null}
          </section>
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="font-bold text-slate-950">History</h3>
            {detail.data.auditHistory.length ? (
              <ol className="mt-2 grid gap-2">
                {detail.data.auditHistory.map((entry) => <li className="text-sm text-slate-700" key={entry.id}><span className="font-semibold">{titleCase(entry.action)}</span><br /><span className="text-xs text-slate-500">{dateTime(entry.createdAt)}</span></li>)}
              </ol>
            ) : <p className="mt-2 text-sm text-slate-600">No status changes yet.</p>}
          </section>
        </aside>
      </div>

      {converting ? (
        <WebsiteInquiryConvertDialog
          api={api}
          inquiry={inquiry}
          matches={matches.data ?? emptyMatches}
          onClose={() => setConverting(false)}
          onConverted={() => void refreshAll()}
        />
      ) : null}
    </article>
  );
}
