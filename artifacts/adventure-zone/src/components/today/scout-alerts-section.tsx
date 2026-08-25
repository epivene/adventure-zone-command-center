import { useMemo, useState } from "react";
import { Link } from "wouter";

export type ScoutAlertSourceView = {
  url: string;
  title: string;
  publisher: string | null;
  category: string;
  retrievedAt: string;
};

export type ScoutAlertView = {
  id: string;
  organizationId: string;
  bookingId: string | null;
  profileName: string;
  kind:
    | "application_opened"
    | "deadline_approaching"
    | "dates_announced"
    | "dates_changed"
    | "contact_changed"
    | "needs_verification"
    | "monitoring_problem";
  severity: "info" | "attention" | "urgent";
  title: string;
  body: string;
  beforeValue: unknown | null;
  afterValue: unknown | null;
  sources: ScoutAlertSourceView[];
  confidence: "high" | "medium" | "low" | null;
  dueAt: string | null;
  detectedAt: string;
};

function priority(severity: ScoutAlertView["severity"]) {
  return severity === "urgent" ? 0 : severity === "attention" ? 1 : 2;
}

function time(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function readableValue(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => readableValue(item)).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item != null && item !== "")
      .map(([key, item]) => `${key.replace(/([A-Z])/g, " $1").replaceAll("_", " ")}: ${readableValue(item)}`)
      .join(" · ");
  }
  return String(value);
}

function severityClasses(severity: ScoutAlertView["severity"]) {
  if (severity === "urgent") return "border-rose-200 bg-rose-50 text-rose-800";
  if (severity === "attention") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function ScoutAlertsSection({
  alerts,
  urgentCount,
  onSnooze,
  onDismiss,
}: {
  alerts: ScoutAlertView[];
  urgentCount: number;
  onSnooze(alertId: string): Promise<void>;
  onDismiss(alertId: string): Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ordered = useMemo(() => alerts.toSorted((left, right) =>
    priority(left.severity) - priority(right.severity)
      || time(left.dueAt) - time(right.dueAt)
      || time(right.detectedAt) - time(left.detectedAt)
      || left.id.localeCompare(right.id)), [alerts]);

  if (!alerts.length) return null;

  async function run(alertId: string, action: () => Promise<void>) {
    if (busyId) return;
    setBusyId(alertId);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this Scout Alert.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <details
      className="rounded-xl border border-orange-200 bg-white p-4 shadow-sm"
      open={urgentCount > 0 || undefined}
    >
      <summary className="cursor-pointer font-bold">
        Scout Alerts <span className="ml-1 text-slate-500">({alerts.length})</span>
        {urgentCount > 0 ? <span className="ml-2 text-xs font-bold text-rose-700">{urgentCount} urgent</span> : null}
      </summary>
      <p className="mt-2 text-sm text-slate-600">Scout found something worth checking on a potential booking.</p>
      {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      <ul className="mt-3 divide-y divide-slate-100">
        {ordered.map((alert) => {
          const before = readableValue(alert.beforeValue);
          const after = readableValue(alert.afterValue);
          const due = formatDate(alert.dueAt);
          const detected = formatDate(alert.detectedAt);
          const href = alert.bookingId
            ? `/profiles/${alert.organizationId}?bookingId=${alert.bookingId}`
            : `/profiles/${alert.organizationId}`;
          return (
            <li className="py-4 first:pt-1 last:pb-0" key={alert.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${severityClasses(alert.severity)}`}>
                      {alert.severity === "urgent" ? "Urgent" : alert.severity === "attention" ? "Needs attention" : "Scout update"}
                    </span>
                    {due ? <span className="text-xs font-semibold text-slate-500">Due {due}</span> : null}
                  </div>
                  <Link className="mt-2 block font-bold text-slate-950 hover:text-orange-700" href={href}>{alert.profileName}</Link>
                  <p className="mt-1 font-semibold text-slate-800">{alert.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{alert.body}</p>
                  {before || after ? (
                    <div className="mt-2 grid gap-1 text-xs text-slate-600">
                      {before ? <p><span className="font-bold">Before:</span> {before.slice(0, 500)}</p> : null}
                      {after ? <p><span className="font-bold">Now:</span> {after.slice(0, 500)}</p> : null}
                    </div>
                  ) : null}
                  {alert.sources.length ? (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {alert.sources.slice(0, 4).map((source) => (
                        <a className="text-xs font-semibold text-orange-700 hover:underline" href={source.url} key={source.url} rel="noreferrer" target="_blank">{source.title}</a>
                      ))}
                    </div>
                  ) : null}
                  {detected ? <p className="mt-2 text-xs text-slate-400">Scouted {detected}{alert.confidence ? ` · ${alert.confidence} confidence` : ""}</p> : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link className="button-secondary" href={href}>Open profile</Link>
                  <button className="button-secondary" disabled={busyId === alert.id} onClick={() => run(alert.id, () => onSnooze(alert.id))} type="button">Snooze 1 week</button>
                  <button className="button-secondary" disabled={busyId === alert.id} onClick={() => run(alert.id, () => onDismiss(alert.id))} type="button">Dismiss</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
