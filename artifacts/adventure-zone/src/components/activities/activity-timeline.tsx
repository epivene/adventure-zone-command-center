"use client";

import { useState } from "react";

import type {
  ActivityKind,
  ActivityParent,
  ActivityRevision,
  ActivityTimelineItem,
  CreateActivityInput,
  EditActivityInput,
} from "@/features/activities/activity-types";
import type { PersistedCallDisposition } from "@/features/calls/call-types";
import { callDispositionValues } from "@/db/schema";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

export type ActivityRevisionResult =
  | { ok: true; revisions: ActivityRevision[]; nextPage?: number | null }
  | { ok: false; error: string };

export type ActivityMutationResult =
  { ok: true; activity: ActivityTimelineItem } | { ok: false; error: string };

export type ActivityTimelinePageResult =
  | { ok: true; items: ActivityTimelineItem[]; nextPage: number | null }
  | { ok: false; error: string };

type EditFormState = {
  open: boolean;
  body: string;
  callOutcome: PersistedCallDisposition;
  reason: string;
  error: string;
  saving: boolean;
};

const manualActivityKinds = [
  ["note", "Note"],
  ["call", "Call"],
  ["follow_up", "Follow-up"],
] as const satisfies readonly (readonly [ActivityKind, string])[];

const defaultCallOutcome: PersistedCallDisposition = "no_answer";
const BODY_PREVIEW_LENGTH = 320;

function isLinkedCall(activity: ActivityTimelineItem) {
  return activity.kind === "call" && activity.hasLinkedCallSession;
}

function formatCallOutcome(outcome: PersistedCallDisposition) {
  const label = outcome.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatActSourceType(sourceType: ActivityTimelineItem["actSourceType"]) {
  if (!sourceType) return "History";
  return sourceType.charAt(0).toUpperCase() + sourceType.slice(1);
}

function defaultEditForm(activity: ActivityTimelineItem): EditFormState {
  return {
    open: false,
    body: activity.body,
    callOutcome: activity.callOutcome ?? defaultCallOutcome,
    reason: "",
    error: "",
    saving: false,
  };
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

export function ActivityTimeline({
  activities,
  parent,
  createActivity,
  editActivity,
  deleteActivity,
  loadRevisions,
  initialNextPage = null,
  loadPage,
  noteComposer = false,
  collapseLongBodies = false,
  openPaperNoteSource,
}: {
  activities: ActivityTimelineItem[];
  parent?: ActivityParent;
  createActivity?: (input: CreateActivityInput) => Promise<ActivityMutationResult>;
  editActivity?: (input: EditActivityInput) => Promise<ActivityMutationResult>;
  deleteActivity?: (activityId: string) => Promise<{ ok: boolean; error?: string }>;
  loadRevisions: (activityId: string, page?: number) => Promise<ActivityRevisionResult>;
  initialNextPage?: number | null;
  loadPage?: (page: number) => Promise<ActivityTimelinePageResult>;
  noteComposer?: boolean;
  collapseLongBodies?: boolean;
  openPaperNoteSource?: (activityId: string) => Promise<void>;
}) {
  const [items, setItems] = useState(activities);
  const [timelineNextPage, setTimelineNextPage] = useState<number | null>(initialNextPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [bodyExpanded, setBodyExpanded] = useState<Record<string, boolean>>({});
  const [revisions, setRevisions] = useState<Record<string, ActivityRevision[]>>({});
  const [nextPages, setNextPages] = useState<Record<string, number | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [newKind, setNewKind] = useState<ActivityKind>("note");
  const [newBody, setNewBody] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editForms, setEditForms] = useState<Record<string, EditFormState>>({});
  const [paperSourceOpening, setPaperSourceOpening] = useState<string | null>(null);
  const [paperSourceErrors, setPaperSourceErrors] = useState<Record<string, string>>({});

  type DeleteConfirmState = { open: boolean; deleting: boolean; error: string };
  const [deleteConfirm, setDeleteConfirm] = useState<Record<string, DeleteConfirmState>>({});

  function deleteConfirmState(activity: ActivityTimelineItem): DeleteConfirmState {
    return deleteConfirm[activity.id] ?? { open: false, deleting: false, error: "" };
  }

  function updateDeleteConfirm(activity: ActivityTimelineItem, patch: Partial<DeleteConfirmState>) {
    setDeleteConfirm((current) => {
      const existing: DeleteConfirmState = current[activity.id] ?? { open: false, deleting: false, error: "" };
      return { ...current, [activity.id]: { ...existing, ...patch } };
    });
  }

  function editForm(activity: ActivityTimelineItem): EditFormState {
    return editForms[activity.id] ?? defaultEditForm(activity);
  }

  function updateEditForm(activity: ActivityTimelineItem, patch: Partial<EditFormState>) {
    setEditForms((current) => ({
      ...current,
      [activity.id]: {
        ...defaultEditForm(activity),
        ...current[activity.id],
        ...patch,
      },
    }));
  }

  async function loadHistory(activityId: string, page?: number) {
    if (loading[activityId]) return;
    setLoading((current) => ({ ...current, [activityId]: true }));
    setErrors((current) => ({ ...current, [activityId]: "" }));
    try {
      const result = page ? await loadRevisions(activityId, page) : await loadRevisions(activityId);
      if (result.ok) {
        setRevisions((current) => ({
          ...current,
          [activityId]: page ? [...(current[activityId] ?? []), ...result.revisions] : result.revisions,
        }));
        setNextPages((current) => ({ ...current, [activityId]: result.nextPage ?? null }));
      } else {
        setErrors((current) => ({ ...current, [activityId]: result.error }));
      }
    } catch {
      setErrors((current) => ({ ...current, [activityId]: "Could not load edit history. Please try again." }));
    } finally {
      setLoading((current) => ({ ...current, [activityId]: false }));
    }
  }

  async function toggleHistory(activity: ActivityTimelineItem) {
    if (expanded[activity.id]) {
      setExpanded((current) => ({ ...current, [activity.id]: false }));
      return;
    }
    setExpanded((current) => ({ ...current, [activity.id]: true }));
    if (revisions[activity.id] || loading[activity.id]) return;
    await loadHistory(activity.id);
  }

  async function openPaperSource(activity: ActivityTimelineItem) {
    if (!openPaperNoteSource || paperSourceOpening) return;
    setPaperSourceOpening(activity.id);
    setPaperSourceErrors((current) => ({ ...current, [activity.id]: "" }));
    try {
      await openPaperNoteSource(activity.paperNoteSource?.activityId ?? activity.id);
    } catch (error) {
      setPaperSourceErrors((current) => ({
        ...current,
        [activity.id]: error instanceof Error ? error.message : "Could not open the original paper note.",
      }));
    } finally {
      setPaperSourceOpening(null);
    }
  }

  async function submitCreate() {
    if (!createActivity || !parent || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const result = await createActivity({
        ...parent,
        kind: noteComposer ? "note" : newKind,
        body: newBody,
        occurredAt: new Date(),
      });
      if (!result.ok) {
        setCreateError(result.error);
        return;
      }
      setItems((current) => [result.activity, ...current]);
      setNewBody("");
      setNewKind("note");
      setAddOpen(false);
    } catch {
      setCreateError("The activity could not be saved. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function submitEdit(activity: ActivityTimelineItem) {
    if (!editActivity) return;
    const form = editForm(activity);
    if (form.saving) return;
    updateEditForm(activity, { saving: true, error: "" });
    try {
      const input: EditActivityInput = {
        activityId: activity.id,
        body: form.body,
        reason: form.reason,
      };
      if (isLinkedCall(activity)) input.callOutcome = form.callOutcome;
      const result = await editActivity({ ...input });
      if (!result.ok) {
        updateEditForm(activity, { saving: false, error: result.error });
        return;
      }
      setItems((current) => current.map((item) => item.id === result.activity.id ? result.activity : item));
      updateEditForm(result.activity, {
        open: false,
        body: result.activity.body,
        callOutcome: result.activity.callOutcome ?? defaultCallOutcome,
        reason: "",
        error: "",
        saving: false,
      });
      setExpanded((current) => ({ ...current, [activity.id]: false }));
      setRevisions((current) => {
        const updated = { ...current };
        delete updated[activity.id];
        return updated;
      });
      setNextPages((current) => {
        const updated = { ...current };
        delete updated[activity.id];
        return updated;
      });
    } catch {
      updateEditForm(activity, { saving: false, error: "The activity edit could not be saved. Please try again." });
    }
  }

  async function submitDelete(activity: ActivityTimelineItem) {
    if (!deleteActivity || deleteConfirmState(activity).deleting) return;
    updateDeleteConfirm(activity, { deleting: true, error: "" });
    try {
      const result = await deleteActivity(activity.id);
      if (!result.ok) {
        updateDeleteConfirm(activity, { deleting: false, error: result.error ?? "Could not delete. Please try again." });
        return;
      }
      setItems((current) => current.filter((item) => item.id !== activity.id));
    } catch {
      updateDeleteConfirm(activity, { deleting: false, error: "Could not delete. Please try again." });
    }
  }

  async function loadMore() {
    if (!loadPage || !timelineNextPage || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const result = await loadPage(timelineNextPage);
      if (!result.ok) {
        setLoadMoreError(result.error);
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !seen.has(item.id))];
      });
      setTimelineNextPage(result.nextPage ?? null);
    } catch {
      setLoadMoreError("Could not load more activity. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const canCreate = Boolean(parent && createActivity);

  return (
    <div>
      {canCreate ? (
        <div className="mb-4">
          <button
            aria-expanded={addOpen}
            className="rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-900 hover:bg-orange-100"
            onClick={() => setAddOpen((current) => !current)}
            type="button"
          >
            {addOpen ? (noteComposer ? "Cancel note" : "Cancel activity") : (noteComposer ? "Add note" : "Add activity")}
          </button>
          {addOpen ? (
            <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-3">
              {!noteComposer ? (
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  Activity type
                  <select className="rounded-md border border-slate-300 bg-white px-3 py-2 font-normal" onChange={(event) => setNewKind(event.target.value as ActivityKind)} value={newKind}>
                    {manualActivityKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                {noteComposer ? "Note" : "Activity text"}
                <textarea
                  className="min-h-24 rounded-md border border-slate-300 px-3 py-2 font-normal"
                  maxLength={4000}
                  onChange={(event) => setNewBody(event.target.value)}
                  value={newBody}
                />
              </label>
              {createError ? <p className="text-sm text-rose-800" role="alert">{createError}</p> : null}
              <button
                className="w-fit rounded-md bg-orange-700 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
                disabled={creating}
                onClick={() => void submitCreate()}
                type="button"
              >
                {creating ? "Saving…" : (noteComposer ? "Save note" : "Save activity")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!items.length ? (
        <p className="text-sm text-slate-600">{noteComposer ? "No notes or call history recorded." : "No recent activity recorded."}</p>
      ) : (
        <ol className="grid gap-3" aria-label="Recent activity">
          {items.map((activity) => {
            const historyId = `activity-history-${activity.id}`;
            const editId = `activity-edit-${activity.id}`;
            const isExpanded = Boolean(expanded[activity.id]);
            const activityRevisions = revisions[activity.id] ?? [];
            const nextPage = nextPages[activity.id];
            const form = editForm(activity);
            const usesCallEditor = isLinkedCall(activity);
            const bodyIsLong = collapseLongBodies && activity.body.length > BODY_PREVIEW_LENGTH;
            const fullBodyVisible = Boolean(bodyExpanded[activity.id]);
            const visibleBody = bodyIsLong && !fullBodyVisible
              ? `${activity.body.slice(0, BODY_PREVIEW_LENGTH).trimEnd()}…`
              : activity.body;

            return (
              <li className="rounded-lg border border-slate-200 bg-slate-50 p-3" key={activity.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold capitalize">{activity.kind.replaceAll("_", " ")}</p>
                    {activity.importedFromAct ? (
                      <p className="mt-1 text-xs font-semibold text-amber-800">
                        Imported from ACT · {formatActSourceType(activity.actSourceType)}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <time dateTime={activity.occurredAt.toISOString()}>{formatDate(activity.occurredAt)}</time>
                    {noteComposer && activity.kind === "note" ? (
                      <p>Created {formatDate(activity.createdAt)}{activity.updatedAt.getTime() !== activity.createdAt.getTime() ? ` · Updated ${formatDate(activity.updatedAt)}` : ""}</p>
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{visibleBody}</p>
                {bodyIsLong ? (
                  <button
                    className="mt-1 text-sm font-semibold text-orange-700 hover:underline"
                    type="button"
                    onClick={() => setBodyExpanded((current) => ({ ...current, [activity.id]: !current[activity.id] }))}
                  >
                    {fullBodyVisible ? "Show less" : "...more"}
                  </button>
                ) : null}
                {usesCallEditor && activity.callOutcome ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Call outcome: <span className="font-medium text-slate-800">{formatCallOutcome(activity.callOutcome)}</span>
                  </p>
                ) : null}
                {activity.paperNoteSource && openPaperNoteSource ? (
                  <div className="mt-3">
                    <button
                      className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-900 hover:bg-orange-100 disabled:opacity-60"
                      disabled={Boolean(paperSourceOpening)}
                      onClick={() => void openPaperSource(activity)}
                      type="button"
                    >
                      {paperSourceOpening === activity.id ? "Opening original note…" : "View original note"}
                    </button>
                    {paperSourceErrors[activity.id] ? <p className="mt-2 text-sm text-rose-800" role="alert">{paperSourceErrors[activity.id]}</p> : null}
                  </div>
                ) : null}

                {editActivity && !activity.importedFromAct ? (
                  <div className="mt-3">
                    <button
                      aria-controls={editId}
                      aria-expanded={form.open}
                      className="text-sm font-semibold text-slate-700 underline-offset-2 hover:underline"
                      onClick={() => updateEditForm(activity, {
                        open: !form.open,
                        body: activity.body,
                        callOutcome: activity.callOutcome ?? defaultCallOutcome,
                        reason: "",
                        error: "",
                      })}
                      type="button"
                    >
                      {form.open ? (usesCallEditor ? "Cancel call edit" : "Cancel edit") : (usesCallEditor ? "Edit call" : "Edit activity")}
                    </button>
                    {form.open ? (
                      <div className="mt-3 grid gap-3 rounded-md border border-slate-200 bg-white p-3" id={editId}>
                        <label className="grid gap-1 text-sm font-semibold text-slate-700">
                          {usesCallEditor ? "Edited call note" : "Edited activity text"}
                          <textarea
                            className="min-h-24 rounded-md border border-slate-300 px-3 py-2 font-normal"
                            maxLength={4000}
                            onChange={(event) => updateEditForm(activity, { body: event.target.value })}
                            value={form.body}
                          />
                        </label>
                        {usesCallEditor ? (
                          <label className="grid gap-1 text-sm font-semibold text-slate-700">
                            Call outcome
                            <select
                              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal"
                              onChange={(event) => updateEditForm(activity, { callOutcome: event.target.value as PersistedCallDisposition })}
                              value={form.callOutcome}
                            >
                              {callDispositionValues.map((value) => <option key={value} value={value}>{formatCallOutcome(value)}</option>)}
                            </select>
                          </label>
                        ) : null}
                        <label className="grid gap-1 text-sm font-semibold text-slate-700">
                          Reason for edit
                          <input
                            className="rounded-md border border-slate-300 px-3 py-2 font-normal"
                            maxLength={500}
                            onChange={(event) => updateEditForm(activity, { reason: event.target.value })}
                            value={form.reason}
                          />
                        </label>
                        {form.error ? <p className="text-sm text-rose-800" role="alert">{form.error}</p> : null}
                        <button
                          className="w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60 sm:w-fit"
                          disabled={form.saving}
                          onClick={() => void submitEdit(activity)}
                          type="button"
                        >
                          {form.saving ? "Saving…" : usesCallEditor ? "Save call edit" : "Save activity edit"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {deleteActivity && !activity.importedFromAct ? (
                  <div className="mt-3">
                    {!deleteConfirmState(activity).open ? (
                      <button
                        className="text-sm font-semibold text-rose-700 underline-offset-2 hover:underline"
                        onClick={() => updateDeleteConfirm(activity, { open: true })}
                        type="button"
                      >
                        Delete activity
                      </button>
                    ) : (
                      <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                        <p className="text-sm font-semibold text-rose-900">Delete this activity?</p>
                        <p className="mt-1 text-sm text-rose-700">This cannot be undone.</p>
                        {deleteConfirmState(activity).error ? <p className="mt-1 text-sm text-rose-800" role="alert">{deleteConfirmState(activity).error}</p> : null}
                        <div className="mt-2 flex gap-2">
                          <button
                            className="rounded bg-rose-600 px-2 py-1 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                            disabled={deleteConfirmState(activity).deleting}
                            onClick={() => void submitDelete(activity)}
                            type="button"
                          >
                            {deleteConfirmState(activity).deleting ? "Deleting…" : "Yes, delete"}
                          </button>
                          <button
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            disabled={deleteConfirmState(activity).deleting}
                            onClick={() => updateDeleteConfirm(activity, { open: false, error: "" })}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {activity.revisionCount ? (
                  <div className="mt-3">
                    <button
                      aria-controls={historyId}
                      aria-expanded={isExpanded}
                      className="text-sm font-semibold text-orange-800 underline-offset-2 hover:underline"
                      onClick={() => void toggleHistory(activity)}
                      type="button"
                    >
                      {isExpanded ? "Hide edit history" : `View edit history (${activity.revisionCount})`}
                    </button>
                    {isExpanded ? (
                      <div className="mt-3 border-l-2 border-slate-200 pl-3" id={historyId}>
                        {loading[activity.id] ? <p className="text-sm text-slate-600">Loading edit history…</p> : null}
                        {errors[activity.id] ? <p className="text-sm text-rose-800" role="alert">{errors[activity.id]}</p> : null}
                        {activityRevisions.length ? (
                          <ol className="grid gap-3" aria-label="Edit history">
                            {activityRevisions.map((revision) => (
                              <li className="text-sm" key={revision.id}>
                                <p className="font-semibold text-slate-700">Previous note</p>
                                <p className="mt-1 whitespace-pre-wrap text-slate-600">{revision.priorBody}</p>
                                {revision.reason ? <p className="mt-1 text-slate-600">Reason: {revision.reason}</p> : null}
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        {nextPage ? (
                          <button
                            className="mt-3 text-sm font-semibold text-orange-800 underline-offset-2 hover:underline disabled:opacity-60"
                            disabled={loading[activity.id]}
                            onClick={() => void loadHistory(activity.id, nextPage)}
                            type="button"
                          >
                            Load older edits
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {loadPage && timelineNextPage ? (
        <div className="mt-4">
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? "Loading older activity…" : "Load older activity"}
          </button>
          {loadMoreError ? <p className="mt-2 text-sm text-rose-800" role="alert">{loadMoreError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
