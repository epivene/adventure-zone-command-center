import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/auth-token";

type ReadyItem = {
  draftId: string;
  opportunityId: string;
  organizationId: string;
  eventName: string;
  recipientEmail: string;
  recipientName: string | null;
  purpose: "new_outreach" | "follow_up" | "reply";
  opportunityStatus: string;
  state: "draft" | "scheduled" | "sent" | "failed" | "cancelled";
  scheduledFor: string | null;
  warning: string | null;
};

type ReadySummary = {
  total: number;
  newOutreach: number;
  followUps: number;
  replies: number;
  items: ReadyItem[];
};

type PreviewItem = ReadyItem & { scheduledFor: string };

function key(kind: "send" | "schedule", draftId: string) {
  return `${kind}:${draftId}:${crypto.randomUUID()}`;
}

function addWeekday(date: Date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}

function tomorrowMorning(now: Date, minuteOffset = 0) {
  const next = addWeekday(now);
  next.setHours(8, minuteOffset, 0, 0);
  return next;
}

export function ReadyToSendSection({ now = () => new Date() }: { now?: () => Date }) {
  const [summary, setSummary] = useState<ReadySummary | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedAt, setPickedAt] = useState("");
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await apiGet<{ ok: true; summary: ReadySummary }>("/today/ready-to-send");
    setSummary(response.summary);
    setSelected(new Set());
  }

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load Ready to Send."));
  }, []);

  const selectedItems = useMemo(
    () => summary?.items.filter((item) => selected.has(item.draftId)) ?? [],
    [summary, selected],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function buildPreview(mode: "tomorrow" | "stagger" | "picked") {
    if (!selectedItems.length) return;
    if (mode === "picked") {
      const picked = new Date(pickedAt);
      if (!pickedAt || !Number.isFinite(picked.getTime()) || picked <= now()) {
        setError("Choose a future date and time.");
        return;
      }
      setPreview(selectedItems.map((item) => ({ ...item, scheduledFor: picked.toISOString() })));
      return;
    }
    setPreview(selectedItems.map((item, index) => ({
      ...item,
      scheduledFor: tomorrowMorning(now(), mode === "stagger" ? index * 15 : 0).toISOString(),
    })));
  }

  async function sendNow() {
    if (!selectedItems.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/today/ready-to-send/send", {
        items: selectedItems.map((item) => ({
          draftId: item.draftId,
          opportunityId: item.opportunityId,
          requestKey: key("send", item.draftId),
        })),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send selected drafts.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSchedule() {
    if (!preview.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/today/ready-to-send/schedule", {
        items: preview.map((item) => ({
          draftId: item.draftId,
          opportunityId: item.opportunityId,
          requestKey: key("schedule", item.draftId),
          scheduledFor: item.scheduledFor,
        })),
      });
      setPreview([]);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not schedule selected drafts.");
    } finally {
      setBusy(false);
    }
  }

  if (!summary) {
    return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">Loading Ready to Send…</section>;
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Ready to Send outbox">
      <button className="flex w-full items-center justify-between gap-3 text-left" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="font-bold">Ready to Send <span className="text-slate-500">({summary.total})</span></span>
        <span className="text-sm text-slate-500">{open ? "Hide" : "Review"}</span>
      </button>
      <p className="mt-1 text-sm text-slate-600">
        {summary.newOutreach} new outreach · {summary.followUps} follow-up · {summary.replies} reply
      </p>

      {error ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p> : null}

      {open ? (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-2">
            {summary.items.map((item) => (
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3" key={item.draftId}>
                <input aria-label={`Select ${item.eventName}`} type="checkbox" checked={selected.has(item.draftId)} onChange={() => toggle(item.draftId)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{item.eventName}</span>
                  <span className="block text-sm text-slate-600">{item.recipientName ? `${item.recipientName} · ` : ""}{item.recipientEmail}</span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{item.purpose.replaceAll("_", " ")} · {item.state}</span>
                  {item.warning ? <span className="mt-1 block text-sm text-rose-700">{item.warning}</span> : null}
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="button-primary" disabled={!selectedItems.length || busy} type="button" onClick={() => void sendNow()}>Send now</button>
            <button className="button-secondary" disabled={!selectedItems.length || busy} type="button" onClick={() => buildPreview("tomorrow")}>Tomorrow morning</button>
            <button className="button-secondary" disabled={!selectedItems.length || busy} type="button" onClick={() => buildPreview("stagger")}>Morning stagger</button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm font-semibold">
              Pick date & time
              <input aria-label="Outbox schedule date and time" className="rounded-lg border border-slate-300 px-3 py-2 font-normal" type="datetime-local" value={pickedAt} onChange={(event) => setPickedAt(event.target.value)} />
            </label>
            <button className="button-secondary" disabled={!selectedItems.length || busy} type="button" onClick={() => buildPreview("picked")}>Pick date & time</button>
          </div>

          {preview.length ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
              <h3 className="font-bold">Schedule preview</h3>
              <div className="mt-2 grid gap-1 text-sm">
                {preview.map((item) => <p key={item.draftId}><strong>{item.eventName}</strong> · {new Date(item.scheduledFor).toLocaleString()}</p>)}
              </div>
              <div className="mt-3 flex gap-2">
                <button className="button-primary" disabled={busy} type="button" onClick={() => void confirmSchedule()}>Confirm schedule</button>
                <button className="button-secondary" disabled={busy} type="button" onClick={() => setPreview([])}>Cancel</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
