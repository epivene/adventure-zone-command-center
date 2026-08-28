import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw, Unplug } from "lucide-react";

import {
  decideOperationalCalendarReview,
  disconnectOperationalCalendar,
  getOperationalCalendarStatus,
  importOperationalCalendar,
  startOperationalCalendarOAuth,
  type OperationalCalendarStatus,
} from "@/features/google-workspace/operational-calendar-client";

export function OperationalCalendarSettingsCard({
  openAuthorizationUrl = (url: string) => window.location.assign(url),
}: {
  openAuthorizationUrl?: (url: string) => void;
}) {
  const [status, setStatus] = useState<OperationalCalendarStatus | null>(null);
  const [busy, setBusy] = useState<"connect" | "import" | "disconnect" | "review" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setStatus(await getOperationalCalendarStatus());
  }

  useEffect(() => {
    void reload().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load David calendar status."));
  }, []);

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      const result = await startOperationalCalendarOAuth();
      openAuthorizationUrl(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start David calendar connection.");
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      const result = await importOperationalCalendar();
      setNotice(`Checked ${result.rows} calendar rows: ${result.updated} updated, ${result.created} created, ${result.review} need review.`);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import David calendar.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect David's operational calendar? Existing CRM events and saved calendar links will stay in the app.")) return;
    setBusy("disconnect");
    setError(null);
    try {
      await disconnectOperationalCalendar();
      await reload();
      setNotice("David's calendar disconnected. CRM data was kept.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect David calendar.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(reviewId: string, decision: "accepted" | "rejected") {
    setBusy("review");
    setError(null);
    try {
      await decideOperationalCalendarReview(reviewId, decision);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the calendar review decision.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="David operational calendar">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-orange-600" />
            <h2 className="text-xl font-bold">David operational calendar</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Connect TheAdventureZone12@gmail.com separately. Existing booked events can be imported, and confirmed app bookings sync back in the familiar manager-first calendar format.
          </p>
          {status?.connection ? (
            <div className="mt-3 text-sm">
              <p className="font-semibold text-slate-900">{status.connection.email}</p>
              <p className="text-slate-600">{status.connection.status === "connected" ? "Connected" : "Reconnect required"} · {status.pendingReviewCount} change{status.pendingReviewCount === 1 ? "" : "s"} need review</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Not connected yet.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="button-primary" disabled={busy !== null} onClick={() => void connect()} type="button">
            {busy === "connect" ? "Opening Google…" : status?.connection ? "Reconnect David calendar" : "Connect David calendar"}
          </button>
          {status?.connection?.status === "connected" ? (
            <button className="button-secondary inline-flex items-center gap-2" disabled={busy !== null} onClick={() => void runImport()} type="button">
              <RefreshCw className="h-4 w-4" />{busy === "import" ? "Importing…" : "Import upcoming events"}
            </button>
          ) : null}
          {status?.connection ? (
            <button className="button-secondary inline-flex items-center gap-2" disabled={busy !== null} onClick={() => void disconnect()} type="button">
              <Unplug className="h-4 w-4" />Disconnect
            </button>
          ) : null}
        </div>
      </div>

      {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p> : null}
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

      {status?.reviews.length ? (
        <div className="grid gap-2">
          <h3 className="font-bold">Calendar changes to review</h3>
          {status.reviews.map((review) => (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" key={review.id}>
              <p className="font-semibold text-amber-950">{review.reason}</p>
              <p className="mt-1 text-xs text-amber-900">Google event: {review.googleEventId}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="button-secondary" disabled={busy !== null} onClick={() => void decide(review.id, "accepted")} type="button">Acknowledge calendar change</button>
                <button className="button-secondary" disabled={busy !== null} onClick={() => void decide(review.id, "rejected")} type="button">Keep app version</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
