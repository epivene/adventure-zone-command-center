import { useCallback, useEffect, useMemo, useState } from "react";

import {
  assignRecoveryParent,
  dropRecoveryItem,
  getRecoveryReview,
  getRecoveryStatus,
  retryRecoveryItem,
  searchRecoveryProfiles,
  startOwnershipRepair,
  startRecovery,
  type ActRecoveryReviewItem,
  type ActRecoveryStatus,
  type RecoveryProfileSearchResult,
} from "@/features/act-recovery/act-recovery-client";

function formatNumber(value: number) {
  return Number(value ?? 0).toLocaleString();
}

function snapshotText(snapshot: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function sourceDate(item: ActRecoveryReviewItem) {
  const value = snapshotText(item.rawSnapshot, [
    "startTime", "StartTime", "displayDate", "DisplayDate", "scheduleDate", "ScheduleDate",
    "createDate", "CreateDate", "created", "Created",
  ]);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceBody(item: ActRecoveryReviewItem) {
  return snapshotText(item.rawSnapshot, [
    "details", "Details", "noteText", "NoteText", "body", "Body", "regarding", "Regarding", "subject", "Subject",
  ]) ?? "No readable ACT text was preserved for this record.";
}

function sourceSubject(item: ActRecoveryReviewItem) {
  return snapshotText(item.rawSnapshot, ["regarding", "Regarding", "subject", "Subject"]);
}

function formatDate(date: Date | null) {
  if (!date) return "Date not preserved";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code.replaceAll("_", " ");
  }
  return error instanceof Error ? error.message : fallback;
}

const timelineStreams = new Set(["note", "history", "activity"]);

function isOwnershipRepairStatus(status: ActRecoveryStatus | null) {
  if (!status || status.candidateCount === 0) return false;
  const streams = Object.keys(status.byStreamType);
  return streams.length > 0 && streams.every((stream) => timelineStreams.has(stream));
}

function statusCards(ownershipRepair: boolean): Array<[string, keyof ActRecoveryStatus]> {
  return [
    [ownershipRepair ? "ACT notes checked" : "Archived candidates", "candidateCount"],
    [ownershipRepair ? "Already correct" : "Already present", "alreadyPresent"],
    [ownershipRepair ? "Moved / repaired" : "Recovered", "recovered"],
    ["Needs review", "needsReview"],
    ["Dropped unusable", "droppedUnusable"],
    ["Retryable failures", "retryableFailed"],
  ];
}

export default function ActRecoveryPage() {
  const [status, setStatus] = useState<ActRecoveryStatus | null>(null);
  const [reviewItems, setReviewItems] = useState<ActRecoveryReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, RecoveryProfileSearchResult[]>>({});
  const [selectedProfile, setSelectedProfile] = useState<Record<string, RecoveryProfileSearchResult | null>>({});

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await getRecoveryStatus();
      setStatus(nextStatus);
      if (nextStatus) {
        const review = await getRecoveryReview(1);
        setReviewItems(review.items);
      } else {
        setReviewItems([]);
      }
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught, "Could not load ACT Recovery."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status || status.complete || status.state === "failed") return;
    const handle = window.setTimeout(() => void refresh(), 3_000);
    return () => window.clearTimeout(handle);
  }, [refresh, status]);

  const progress = useMemo(() => {
    if (!status?.candidateCount) return 0;
    return Math.min(100, Math.round((status.checkedCount / status.candidateCount) * 100));
  }, [status]);
  const ownershipRepairMode = isOwnershipRepairStatus(status);
  const cards = statusCards(ownershipRepairMode);

  async function beginRecovery() {
    setBusy("start");
    setError(null);
    try {
      setStatus(await startRecovery());
      const review = await getRecoveryReview(1);
      setReviewItems(review.items);
    } catch (caught) {
      setError(errorMessage(caught, "Could not start ACT Recovery."));
    } finally {
      setBusy(null);
      setLoading(false);
    }
  }

  async function beginOwnershipRepair() {
    setBusy("repair");
    setError(null);
    try {
      setStatus(await startOwnershipRepair());
      const review = await getRecoveryReview(1);
      setReviewItems(review.items);
    } catch (caught) {
      setError(errorMessage(caught, "Could not start ACT note ownership repair."));
    } finally {
      setBusy(null);
      setLoading(false);
    }
  }

  async function searchProfiles(item: ActRecoveryReviewItem) {
    setBusy(`search:${item.sourceRecordId}`);
    setError(null);
    try {
      const results = await searchRecoveryProfiles(searchText[item.sourceRecordId] ?? "");
      setSearchResults((current) => ({ ...current, [item.sourceRecordId]: results }));
    } catch (caught) {
      setError(errorMessage(caught, "Could not search profiles."));
    } finally {
      setBusy(null);
    }
  }

  async function assign(item: ActRecoveryReviewItem) {
    const target = selectedProfile[item.sourceRecordId];
    if (!target) return;
    setBusy(`assign:${item.sourceRecordId}`);
    setError(null);
    try {
      await assignRecoveryParent({
        sourceRecordId: item.sourceRecordId,
        sourceVersionId: item.sourceVersionId,
        targetEntityType: "organization",
        targetEntityId: target.id,
      });
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, "Could not assign this ACT record."));
    } finally {
      setBusy(null);
    }
  }

  async function drop(item: ActRecoveryReviewItem) {
    setBusy(`drop:${item.sourceRecordId}`);
    setError(null);
    try {
      await dropRecoveryItem({
        sourceRecordId: item.sourceRecordId,
        sourceVersionId: item.sourceVersionId,
      });
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, "Could not drop this ACT record."));
    } finally {
      setBusy(null);
    }
  }

  async function retry(item: ActRecoveryReviewItem) {
    setBusy(`retry:${item.sourceRecordId}`);
    setError(null);
    try {
      await retryRecoveryItem({
        sourceRecordId: item.sourceRecordId,
        sourceVersionId: item.sourceVersionId,
      });
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught, "Could not retry this ACT record."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 pb-12 pt-8">
      <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Archive salvage</p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">ACT Recovery</h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              {ownershipRepairMode
                ? "Recheck ACT notes, history, and activities against their preserved ACT relationships and move misplaced records to the correct profiles."
                : "Recover useful records already preserved in the ACT archive. Exact ACT relationships are used automatically; uncertain ownership stays here for review instead of disappearing."}
            </p>
          </div>
          {status?.complete ? (
            <button
              className="button-primary min-h-11 shrink-0"
              disabled={busy !== null}
              onClick={() => void beginOwnershipRepair()}
              type="button"
            >
              {busy === "repair" ? "Starting repair…" : ownershipRepairMode ? "Run Ownership Repair Again" : "Repair ACT Note Ownership"}
            </button>
          ) : (
            <button
              className="button-primary min-h-11 shrink-0"
              disabled={busy !== null}
              onClick={() => void beginRecovery()}
              type="button"
            >
              {busy === "start" ? "Starting…" : status ? "Resume Recovery" : "Start Recovery"}
            </button>
          )}
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">Loading ACT Recovery…</p> : null}

      {status ? (
        <section className="grid gap-4" aria-labelledby="recovery-status-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold" id="recovery-status-heading">{ownershipRepairMode ? "Ownership repair status" : "Recovery status"}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {formatNumber(status.checkedCount)} of {formatNumber(status.candidateCount)} {ownershipRepairMode ? "ACT timeline records checked" : "archived candidates classified"}.
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${status.complete ? "bg-green-100 text-green-800" : status.state === "failed" ? "bg-rose-100 text-rose-800" : "bg-blue-100 text-blue-800"}`}>
              {status.complete ? "Complete" : status.state === "failed" ? "Failed" : "Running"}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-label={`${progress}% classified`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full bg-orange-600" style={{ width: `${progress}%` }} />
          </div>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {cards.map(([label, key]) => (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="mt-2 text-2xl font-bold text-slate-950">{formatNumber(Number(status[key]))}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(status.byStreamType).length ? (
            <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-semibold">Counts by ACT record type</summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr><th className="py-2">Type</th><th>Archived</th><th>{ownershipRepairMode ? "Already correct" : "Present"}</th><th>{ownershipRepairMode ? "Moved / repaired" : "Recovered"}</th><th>Review</th><th>Dropped</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(status.byStreamType).map(([streamType, counts]) => (
                      <tr key={streamType}>
                        <td className="py-2 font-semibold">{streamType.replaceAll("_", " ")}</td>
                        <td>{formatNumber(counts.candidateCount)}</td>
                        <td>{formatNumber(counts.alreadyPresent)}</td>
                        <td>{formatNumber(counts.recovered)}</td>
                        <td>{formatNumber(counts.needsReview)}</td>
                        <td>{formatNumber(counts.droppedUnusable)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>
      ) : !loading ? (
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-5">
          <h2 className="font-bold text-orange-950">No archive recovery run yet</h2>
          <p className="mt-1 text-sm text-orange-900">Start Recovery to classify and salvage the ACT data already stored in Command Center.</p>
        </section>
      ) : null}

      {status && (
        <section className="grid gap-4" aria-labelledby="recovery-review-heading">
          <div>
            <h2 className="text-xl font-bold" id="recovery-review-heading">Recovery Review</h2>
            <p className="mt-1 text-sm text-slate-600">Only meaningful records whose ownership could not be proven automatically appear here.</p>
          </div>

          {reviewItems.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No ACT records currently need manual review.
            </div>
          ) : reviewItems.map((item) => {
            const selected = selectedProfile[item.sourceRecordId] ?? null;
            const results = searchResults[item.sourceRecordId] ?? [];
            const subject = sourceSubject(item);
            return (
              <article className="grid gap-4 rounded-xl border border-amber-200 bg-white p-5 shadow-sm" key={item.itemId}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">ACT {item.streamType.replaceAll("_", " ")}</p>
                    {subject ? <h3 className="mt-1 text-lg font-bold text-slate-950">{subject}</h3> : null}
                    <p className="mt-1 text-sm text-slate-500">{formatDate(sourceDate(item))}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Review required</span>
                </div>

                <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{sourceBody(item)}</p>

                {Object.keys(item.relationshipEvidence).length ? (
                  <details className="rounded-lg border border-slate-200 p-3">
                    <summary className="cursor-pointer text-sm font-semibold">Archived relationship evidence</summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600">{JSON.stringify(item.relationshipEvidence, null, 2)}</pre>
                  </details>
                ) : null}

                <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <label className="text-sm font-semibold text-slate-700" htmlFor={`profile-search-${item.sourceRecordId}`}>Find profile</label>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      id={`profile-search-${item.sourceRecordId}`}
                      onChange={(event) => setSearchText((current) => ({ ...current, [item.sourceRecordId]: event.target.value }))}
                      placeholder="Search event, organization, or venue"
                      value={searchText[item.sourceRecordId] ?? ""}
                    />
                    <button className="button-secondary" disabled={busy !== null} onClick={() => void searchProfiles(item)} type="button">Search profiles</button>
                  </div>
                  {results.length ? (
                    <div className="grid gap-2">
                      {results.map((profile) => {
                        const location = [profile.city, profile.region].filter(Boolean).join(", ");
                        return (
                          <button
                            aria-pressed={selected?.id === profile.id}
                            className={`rounded-lg border p-3 text-left text-sm ${selected?.id === profile.id ? "border-orange-500 bg-orange-50" : "border-slate-200 bg-white"}`}
                            key={profile.id}
                            onClick={() => setSelectedProfile((current) => ({ ...current, [item.sourceRecordId]: profile }))}
                            type="button"
                          >
                            <span className="font-semibold">{profile.name}</span>{location ? <span className="text-slate-500"> — {location}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button className="button-primary" disabled={!selected || busy !== null} onClick={() => void assign(item)} type="button">Assign &amp; retry</button>
                    <button className="button-secondary" disabled={busy !== null} onClick={() => void retry(item)} type="button">Retry as-is</button>
                    <button className="button-secondary text-rose-700" disabled={busy !== null} onClick={() => void drop(item)} type="button">Drop unusable</button>
                  </div>
                  {selected ? <p className="text-xs text-slate-600">Will attach this ACT record to <strong>{selected.name}</strong> using your explicit review decision.</p> : null}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
