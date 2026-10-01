import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth-token";
function syncDescription(state: string) {
  return (
    (
      {
        completed: "complete",
        complete: "complete",
        pending: "waiting",
        retry_required: "needs retry",
        retryable_error: "needs retry",
        partial: "partly saved",
        disabled: "disabled",
        superseded: "new review needed",
      } as Record<string, string>
    )[state] ?? "needs attention"
  );
}
export function EmailAttentionControls({
  messageId,
  profileId,
  onSaved,
  onCancel,
}: {
  messageId: string;
  profileId: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const [state, setState] = useState("needs_your_reply"),
    [year, setYear] = useState(""),
    [reason, setReason] = useState("");
  const [preview, setPreview] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [loading, setLoading] = useState(true),
    [contextFailed, setContextFailed] = useState(false);
  const [followup, setFollowup] = useState<{
    dueAt: string | null;
    followupId: string | null;
  }>({ dueAt: null, followupId: null });
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiFetch(
          "/email-thread-attention/context?" +
            new URLSearchParams({ messageId }),
        );
        if (!response.ok)
          throw Error(
            "Could not load the saved conversation. Reopen it to retry.",
          );
        const saved = await response.json();
        if (!active) return;
        if (saved) {
          if (saved.profileId !== profileId)
            throw Error(
              "This conversation is already filed under another profile.",
            );
          setState(saved.state);
          setYear(saved.eventYear == null ? "" : String(saved.eventYear));
          setReason(saved.reason);
          setFollowup({ dueAt: saved.dueAt, followupId: saved.followupId });
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setContextFailed(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [messageId, profileId]);
  async function post(path: string, body: unknown) {
    const response = await apiFetch("/email-thread-attention/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error || "Could not update this conversation.");
    return data;
  }
  async function review() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const p = await post("preview", {
        messageId,
        profileId,
        eventYear: year ? Number(year) : null,
        state,
        reason,
        ...followup,
      });
      setPreview(p);
      setRequestKey(crypto.randomUUID());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const saved = await post("apply", {
        previewId: preview.id,
        expectedRevision: preview.expectedRevision,
        requestKey,
      });
      setResult(saved);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="grid min-w-0 gap-3 rounded-xl border bg-white p-4 text-slate-900"
      aria-label="Conversation filing"
    >
      <h3 className="font-bold">File conversation and track next action</h3>
      <a
        href={"/profiles/" + encodeURIComponent(profileId)}
        className="text-sm font-semibold underline"
      >
        Open profile and conversation history
      </a>
      {loading ? <p>Loading saved conversation…</p> : null}
      {!preview ? (
        <>
          <label className="grid gap-1">
            Conversation status
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="rounded border p-2"
            >
              <option value="needs_your_reply">Needs your reply</option>
              <option value="waiting_for_their_reply">
                Waiting for their reply
              </option>
              <option value="resolved">Resolved — nothing outstanding</option>
            </select>
          </label>
          <label className="grid gap-1">
            Event year (leave blank if unconfirmed)
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded border p-2"
            />
          </label>
          <label className="grid gap-1">
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="rounded border p-2"
            />
          </label>
          <button
            disabled={busy || loading || contextFailed || !reason.trim()}
            onClick={() => void review()}
            className="button-primary"
          >
            Preview filing
          </button>
        </>
      ) : (
        <>
          <p className="break-words font-semibold">{preview.subject}</p>
          <p>
            {preview.profileName ?? "Selected profile"} ·{" "}
            {preview.eventYear ?? "Year unconfirmed"}
          </p>
          <p>
            {preview.state === "resolved"
              ? "Keep the profile label and clear Needs Attention."
              : "Keep the profile label and add Needs Attention in Gmail and Today."}{" "}
            Remove Inbox after labels are verified.
          </p>
          <button
            disabled={busy}
            onClick={() => void apply()}
            className="button-primary"
          >
            {result ? "Retry synchronization" : "Apply filing"}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPreview(null);
              setResult(null);
            }}
          >
            Change details
          </button>
        </>
      )}
      {result ? (
        <p role="status">
          Profile saved. Gmail: {syncDescription(result.gmailSync.state)}.
          Profile history: {syncDescription(result.archiveSync.state)}.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-red-700">
          {error}
        </p>
      ) : null}
      {onCancel ? <button onClick={onCancel}>Close</button> : null}
    </section>
  );
}
