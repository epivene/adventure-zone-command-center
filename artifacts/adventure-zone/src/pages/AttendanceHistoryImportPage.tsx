import { useEffect, useState } from "react";
import { Link } from "wouter";

import { apiGet, apiPost } from "@/lib/auth-token";

type Status = {
  id: string;
  year: number;
  status: "attended" | "blacklisted" | "cancelled_last_minute";
};

type Target = {
  organizationId: string;
  organizationName: string;
  organizationLocationId?: string | null;
  locationId?: string | null;
  city: string | null;
  region: string | null;
};

type Row = {
  id: string;
  sourceRowNumber: number;
  month: string;
  originalEventName: string;
  originalLocation: string;
  matchState: "pending" | "confident" | "approved" | "new_profile_candidate" | "rejected";
  matchConfidence: string | null;
  matchReason: string | null;
  matchedOrganizationId: string | null;
  matchedLocationId: string | null;
  matchedTarget: Target | null;
  statuses: Status[];
};

type Filter = "all" | Row["matchState"];

const filters: Array<{ value: Filter; label: string }> = [
  { value: "pending", label: "Needs review" },
  { value: "confident", label: "Confident" },
  { value: "new_profile_candidate", label: "New profile candidates" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function statusLabel(status: Status["status"]) {
  if (status === "attended") return "Attended";
  if (status === "blacklisted") return "Blacklisted history";
  return "Cancelled last minute";
}

function statusClasses(status: Status["status"]) {
  if (status === "attended") return "bg-emerald-100 text-emerald-800";
  if (status === "blacklisted") return "bg-slate-900 text-white";
  return "bg-amber-100 text-amber-900";
}

function targetLabel(target: Target | null) {
  if (!target) return "No profile selected";
  const location = [target.city, target.region].filter(Boolean).join(", ");
  return location ? `${target.organizationName} · ${location}` : target.organizationName;
}

function ReviewCard({ row, onReload }: { row: Row; onReload: () => Promise<void> }) {
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(row.matchedTarget);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState(`${row.originalEventName.trim()} ${row.originalLocation.trim()}`);
  const [options, setOptions] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setSelectedTarget(row.matchedTarget), [row.matchedTarget]);

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiGet<{ options: Target[] }>(
        `/imports/attendance-history/profile-options?q=${encodeURIComponent(query.trim())}`,
      );
      setOptions(data.options ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not search profiles.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!selectedTarget || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/imports/attendance-history/${row.id}/approve`, {
        organizationId: selectedTarget.organizationId,
        organizationLocationId:
          selectedTarget.organizationLocationId ?? selectedTarget.locationId ?? null,
      });
      await onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not approve this history match.");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (busy) return;
    const reason = window.prompt(`Why should “${row.originalEventName}” be rejected from this import?`);
    if (!reason?.trim()) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/imports/attendance-history/${row.id}/reject`, { reason: reason.trim() });
      await onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reject this source row.");
    } finally {
      setBusy(false);
    }
  }

  async function rematch() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiPost(`/imports/attendance-history/${row.id}/rematch`, {});
      await onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rematch this source row.");
    } finally {
      setBusy(false);
    }
  }

  const confidence = row.matchConfidence == null ? null : Math.round(Number(row.matchConfidence) * 100);

  return (
    <article className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Source row {row.sourceRowNumber} · {row.month}
          </p>
          <h2 className="mt-1 text-lg font-bold">{row.originalEventName}</h2>
          <p className="text-sm text-slate-600">{row.originalLocation}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize">
            {row.matchState.replaceAll("_", " ")}
          </span>
          {confidence !== null ? (
            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800">
              {confidence}% match confidence
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {row.statuses.length ? row.statuses.map((status) => (
          <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusClasses(status.status)}`} key={status.id}>
            {status.year} · {statusLabel(status.status)}
          </span>
        )) : <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">No yearly status marks in source</span>}
      </div>

      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <p><span className="font-semibold">Suggested / selected profile:</span> {targetLabel(selectedTarget)}</p>
        <p className="mt-1"><span className="font-semibold">Match reason:</span> {row.matchReason ?? "Not evaluated yet."}</p>
      </div>

      {row.statuses.some((status) => status.status === "blacklisted") ? (
        <p className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm font-semibold text-slate-800">
          “Blacklisted” is preserved as historical workbook status only. It does not automatically mark a contact or phone Do Not Call.
        </p>
      ) : null}

      {row.matchState !== "approved" && row.matchState !== "rejected" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button className="button-secondary" onClick={() => setSearchOpen((open) => !open)} type="button">
              Search / Change Match
            </button>
            <button className="button-primary" disabled={!selectedTarget || busy} onClick={() => void approve()} type="button">
              {busy ? "Working…" : "Approve"}
            </button>
            <button className="button-secondary" disabled={busy} onClick={() => void rematch()} type="button">Rematch</button>
            <button className="button-secondary" disabled={busy} onClick={() => void reject()} type="button">Reject</button>
            {row.matchState === "new_profile_candidate" ? (
              <Link className="button-secondary" href="/event-profiles/new">Create normal profile</Link>
            ) : null}
          </div>

          {searchOpen ? (
            <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
              <div className="flex gap-2">
                <input
                  aria-label={`Search profile for ${row.originalEventName}`}
                  className="min-w-0 flex-1"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  value={query}
                />
                <button className="button-secondary" disabled={busy || !query.trim()} onClick={() => void search()} type="button">Search</button>
              </div>
              {options.length ? (
                <div className="grid gap-2">
                  {options.map((option, index) => (
                    <button
                      className="rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"
                      key={`${option.organizationId}:${option.organizationLocationId ?? index}`}
                      onClick={() => { setSelectedTarget(option); setSearchOpen(false); }}
                      type="button"
                    >
                      <span className="font-semibold">{option.organizationName}</span>
                      <span className="ml-2 text-sm text-slate-600">{[option.city, option.region].filter(Boolean).join(", ") || "No location"}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">Search to see active profile/location options.</p>}
            </div>
          ) : null}
        </>
      ) : null}

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </article>
  );
}

export default function AttendanceHistoryImportPage() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const path = filter === "all"
        ? "/imports/attendance-history"
        : `/imports/attendance-history?state=${encodeURIComponent(filter)}`;
      const data = await apiGet<{ rows: Row[] }>(path);
      setRows(data.rows ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load attendance history review.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [filter]);

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Imports &amp; Data</p>
        <h1 className="mt-1 text-3xl font-bold">Attendance history import</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Review the attended-calendar workbook against existing event profiles before historical records are attached. The complete source contains 110 event/month rows and 198 year-status cells.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Attendance import filters">
        {filters.map((item) => (
          <button
            className={filter === item.value ? "button-primary" : "button-secondary"}
            key={item.value}
            onClick={() => setFilter(item.value)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {loading ? <p className="text-sm text-slate-500">Loading attendance source rows…</p> : null}
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No rows in this review state.</p>
      ) : null}

      <div className="grid gap-3">
        {rows.map((row) => <ReviewCard key={row.id} row={row} onReload={load} />)}
      </div>
    </div>
  );
}
