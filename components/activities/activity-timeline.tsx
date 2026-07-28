"use client";

import { useState } from "react";

import type {
  ActivityRevision,
  ActivityTimelineItem,
} from "@/features/activities/activity-types";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";

export type ActivityRevisionResult =
  | { ok: true; revisions: ActivityRevision[] }
  | { ok: false; error: string };

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

export function ActivityTimeline({
  activities,
  loadRevisions,
}: {
  activities: ActivityTimelineItem[];
  loadRevisions: (activityId: string) => Promise<ActivityRevisionResult>;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [revisions, setRevisions] = useState<Record<string, ActivityRevision[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  async function toggleHistory(activity: ActivityTimelineItem) {
    if (expanded[activity.id]) {
      setExpanded((current) => ({ ...current, [activity.id]: false }));
      return;
    }
    setExpanded((current) => ({ ...current, [activity.id]: true }));
    if (revisions[activity.id] || loading[activity.id]) return;

    setLoading((current) => ({ ...current, [activity.id]: true }));
    setErrors((current) => ({ ...current, [activity.id]: "" }));
    try {
      const result = await loadRevisions(activity.id);
      if (result.ok) {
        setRevisions((current) => ({ ...current, [activity.id]: result.revisions }));
      } else {
        setErrors((current) => ({ ...current, [activity.id]: result.error }));
      }
    } catch {
      setErrors((current) => ({
        ...current,
        [activity.id]: "Could not load edit history. Please try again.",
      }));
    } finally {
      setLoading((current) => ({ ...current, [activity.id]: false }));
    }
  }

  if (!activities.length) {
    return <p className="text-sm text-slate-600">No recent activity recorded.</p>;
  }

  return (
    <ol className="grid gap-3" aria-label="Recent activity">
      {activities.map((activity) => {
        const historyId = `activity-history-${activity.id}`;
        const isExpanded = Boolean(expanded[activity.id]);
        const activityRevisions = revisions[activity.id] ?? [];
        return (
          <li className="rounded-lg border border-slate-200 bg-slate-50 p-3" key={activity.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold capitalize">
                {activity.kind.replaceAll("_", " ")}
              </p>
              <time className="text-xs text-slate-500" dateTime={activity.occurredAt.toISOString()}>
                {formatDate(activity.occurredAt)}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {activity.body}
            </p>
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
                            {revision.reason ? (
                              <p className="mt-1 text-slate-600">Reason: {revision.reason}</p>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
