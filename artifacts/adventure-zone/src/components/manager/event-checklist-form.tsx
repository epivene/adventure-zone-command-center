import { useEffect, useMemo, useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { ManagerSyncStatus } from "./manager-sync-status";
import { ChecklistPhotoCapture } from "./checklist-photo-capture";
import {
  queueChecklistAnswer,
  type ManagerChecklist,
  type ManagerChecklistItem,
  type ManagerChecklistResult,
  type ManagerChecklistSyncState,
} from "@/features/manager/event-checklist-client";

type DraftAnswer = {
  result: ManagerChecklistResult | null;
  note: string;
  syncState: ManagerChecklistSyncState | null;
  error: string;
};

const choices: Array<{ value: ManagerChecklistResult; label: string }> = [
  { value: "acceptable", label: "Acceptable" },
  { value: "needs_work_safe", label: "Needs work but safe" },
  { value: "unsafe", label: "Unsafe — cannot operate" },
  { value: "not_applicable", label: "Not applicable" },
];

function needsNote(item: ManagerChecklistItem, result: ManagerChecklistResult | null) {
  return result === "needs_work_safe" || result === "unsafe" || (result === "not_applicable" && item.safetyCritical);
}

function initialDraft(item: ManagerChecklistItem): DraftAnswer {
  return {
    result: item.result,
    note: item.note ?? "",
    syncState: null,
    error: "",
  };
}

export function EventChecklistForm({
  checklist,
  onRefresh,
}: {
  checklist: ManagerChecklist;
  onRefresh?: () => void | Promise<void>;
}) {
  const { manager, managerApi } = useManagerAuth();
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>(() =>
    Object.fromEntries(checklist.items.map((item) => [item.resultId, initialDraft(item)])),
  );

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const item of checklist.items) {
        const prior = next[item.resultId];
        if (!prior || prior.syncState === "synced" || prior.syncState === null) {
          next[item.resultId] = initialDraft(item);
        }
      }
      return next;
    });
  }, [checklist]);

  const unresolvedSafety = useMemo(
    () => checklist.items.some((item) => item.followUpSyncState === "pending" || item.followUpSyncState === "needs_attention"),
    [checklist.items],
  );

  function updateDraft(resultId: string, patch: Partial<DraftAnswer>) {
    setDrafts((current) => ({
      ...current,
      [resultId]: { ...current[resultId], ...patch },
    }));
  }

  async function persist(item: ManagerChecklistItem, override?: Partial<DraftAnswer>) {
    if (!manager) return;
    const draft = { ...drafts[item.resultId], ...override };
    if (!draft.result) return;
    if (needsNote(item, draft.result) && !draft.note.trim()) {
      updateDraft(item.resultId, { error: "Note required for this result." });
      return;
    }
    updateDraft(item.resultId, { syncState: "syncing", error: "" });
    try {
      const syncState = await queueChecklistAnswer({
        managerApi,
        bookingId: checklist.bookingId,
        legId: manager.legId,
        resultId: item.resultId,
        result: draft.result,
        note: draft.note.trim() || null,
      });
      updateDraft(item.resultId, { syncState, error: syncState === "needs_attention" ? "Needs attention before this checklist can be completed." : "" });
      if (syncState === "synced") await onRefresh?.();
    } catch (cause) {
      updateDraft(item.resultId, {
        syncState: "needs_attention",
        error: cause instanceof Error ? cause.message : "Could not save this answer.",
      });
    }
  }

  async function choose(item: ManagerChecklistItem, result: ManagerChecklistResult) {
    const next = { result, error: "" };
    updateDraft(item.resultId, next);
    const currentNote = drafts[item.resultId]?.note ?? "";
    if (!needsNote(item, result) || currentNote.trim()) {
      await persist(item, { result });
    }
  }

  return (
    <div className="grid gap-4">
      {unresolvedSafety ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-900" role="alert">
          Needs attention: at least one safety follow-up has not synced successfully yet. The checklist cannot be treated as complete until it is resolved or the owner records the appropriate override.
        </div>
      ) : null}

      {checklist.items.map((item, index) => {
        const draft = drafts[item.resultId] ?? initialDraft(item);
        const noteRequired = needsNote(item, draft.result);
        return (
          <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={item.resultId}>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{index + 1} of {checklist.items.length}</span>
                {item.safetyCritical ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">Safety critical</span> : null}
              </div>
              {item.resourceName ? <p className="mt-2 text-sm font-bold uppercase tracking-wide text-orange-700">{item.resourceName}</p> : <p className="mt-2 text-sm font-bold uppercase tracking-wide text-slate-500">Event site</p>}
              <h2 className="mt-1 text-lg font-bold leading-snug text-slate-950">{item.label}</h2>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {choices.map((choice) => {
                const selected = draft.result === choice.value;
                return (
                  <button
                    aria-pressed={selected}
                    className={`min-h-14 rounded-xl border-2 px-3 py-3 text-left font-bold ${selected ? "border-orange-500 bg-orange-50 text-orange-950" : "border-slate-200 bg-white text-slate-900"}`}
                    disabled={checklist.state !== "in_progress"}
                    key={choice.value}
                    onClick={() => void choose(item, choice.value)}
                    type="button"
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>

            {noteRequired ? (
              <label className="grid gap-1 text-sm font-bold text-slate-800">
                Note required
                <textarea
                  className="min-h-24"
                  disabled={checklist.state !== "in_progress"}
                  onBlur={() => void persist(item)}
                  onChange={(event) => updateDraft(item.resultId, { note: event.currentTarget.value, error: "" })}
                  placeholder={draft.result === "unsafe" ? "Describe what is unsafe and what needs to happen before this attraction can operate." : "Describe the condition and follow-up needed."}
                  value={draft.note}
                />
              </label>
            ) : draft.result ? (
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                Note <span className="font-normal text-slate-500">(optional)</span>
                <textarea
                  className="min-h-20"
                  disabled={checklist.state !== "in_progress"}
                  onBlur={() => void persist(item)}
                  onChange={(event) => updateDraft(item.resultId, { note: event.currentTarget.value })}
                  value={draft.note}
                />
              </label>
            ) : null}

            {draft.result === "unsafe" || draft.result === "needs_work_safe" ? (
              <ChecklistPhotoCapture bookingId={checklist.bookingId} resultId={item.resultId} onDone={onRefresh} />
            ) : null}

            {item.photoCount > 0 ? <p className="text-xs font-semibold text-slate-500">{item.photoCount} {item.photoCount === 1 ? "photo" : "photos"} attached</p> : null}
            {draft.syncState ? <ManagerSyncStatus state={draft.syncState} /> : null}
            {item.followUpSyncState === "needs_attention" ? <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">Needs attention: the safety follow-up did not sync. Retrying this answer will retry the follow-up without duplicating the issue.</p> : null}
            {draft.error ? <p className="text-sm font-semibold text-rose-700" role="alert">{draft.error}</p> : null}
          </section>
        );
      })}
    </div>
  );
}
