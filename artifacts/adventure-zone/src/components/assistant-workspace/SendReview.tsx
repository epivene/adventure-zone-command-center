import { useState } from "react";
import type { Draft } from "@/features/assistant-workspace/types";
import { workspaceApi } from "@/features/assistant-workspace/api";
export function SendReview({
  draft,
  onClose,
  onChanged,
}: {
  draft: Draft;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [payment, setPayment] = useState("administrative"),
    [intent, setIntent] = useState("administrative"),
    [hold, setHold] = useState(""),
    [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [review, setReview] = useState<{
      status: string;
      revision: string;
      digest: string | null;
      html: string;
      reviewReasons: string[];
    } | null>(null);
  async function load() {
    setBusy(true);
    setError("");
    try {
      setReview(
        await workspaceApi(`/drafts/${draft.id}/send-review`, "POST", {
          revision: draft.revision,
          paymentModel: payment,
        }),
      );
    } catch {
      setError(
        "The send review is blocked. Check the current Gmail draft, selected event year, contact and outreach settings.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!review) return;
    setBusy(true);
    try {
      const parsed = new DOMParser().parseFromString(review.html, "text/html");
      parsed.querySelectorAll("style,script").forEach((n) => n.remove());
      await workspaceApi(`/drafts/${draft.id}`, "PATCH", {
        revision: draft.revision,
        subject: draft.content.subject,
        html: review.html,
        text: parsed.body.textContent?.trim() || draft.content.text,
      });
      await onChanged();
      onClose();
    } catch {
      setError(
        "The draft changed. Reload the preview before applying this wording.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!review?.digest || !checked) return;
    setBusy(true);
    setError("");
    try {
      await workspaceApi(`/drafts/${draft.id}/send-approval`, "POST", {
        revision: draft.revision,
        digest: review.digest,
        intent,
        holdId: intent === "specific_offer" ? hold || null : null,
        stage: intent === "exploratory" ? "initial" : null,
        reason,
        evidenceReviewed: true,
      });
      const output = await workspaceApi<{
        status: string;
        code: string | null;
      }>(`/drafts/${draft.id}/send`, "POST", {
        revision: draft.revision,
        requestKey: crypto.randomUUID(),
      });
      await onChanged();
      if (output.status === "ok") onClose();
      else if (output.code === "ASSISTANT_SEND_NOT_DISPATCHED") {
        setReview(null);
        setChecked(false);
        setError(
          "Nothing was sent. Sources changed during the final check. Review the latest draft and sources again.",
        );
      } else
        setError(
          "Delivery is not confirmed. Use Check result on the saved action; do not resend.",
        );
    } catch {
      setError(
        "The email was not confirmed as sent. Review the action result and any changed draft or offer information.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Review email before sending"
      className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4"
    >
      <div className="flex justify-between gap-3">
        <h3 className="font-semibold">Review before sending</h3>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-sm underline"
        >
          Close
        </button>
      </div>
      <p className="text-sm">
        {draft.content.subject} → {draft.content.to.join(", ")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      <label className="block text-sm">
        Payment context
        <select
          className="mt-1 w-full rounded border bg-white p-2"
          value={payment}
          onChange={(e) => {
            setPayment(e.target.value);
            setReview(null);
            setChecked(false);
          }}
        >
          <option value="administrative">No commercial offer</option>
          <option value="prepaid">Prepaid / flat fee</option>
          <option value="pay_per_play">Pay per play</option>
        </select>
      </label>
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        className="rounded border bg-white px-3 py-2 text-sm"
      >
        Check current draft and offer
      </button>
      {review && (
        <>
          <iframe
            title="Final send preview"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={review.html}
            className="h-80 w-full border bg-white"
          />
          {review.reviewReasons.length > 0 && (
            <ul className="list-disc pl-5 text-sm">
              {review.reviewReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          {review.status === "revision_required" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply()}
              className="rounded bg-teal-800 px-3 py-2 text-sm text-white"
            >
              Apply refreshed wording as a new revision
            </button>
          ) : (
            <>
              <label className="block text-sm">
                Purpose
                <select
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  className="mt-1 w-full rounded border bg-white p-2"
                >
                  <option value="administrative">Administrative reply</option>
                  <option value="exploratory">Exploratory outreach</option>
                  <option value="specific_offer">
                    Specific offer with reserved capacity
                  </option>
                </select>
              </label>
              {intent === "specific_offer" && (
                <label className="block text-sm">
                  Approved capacity hold
                  <input
                    value={hold}
                    onChange={(e) => setHold(e.target.value)}
                    placeholder="Hold ID from Outreach Planner"
                    className="mt-1 w-full rounded border p-2"
                  />
                  <a href="/outreach-planner" className="text-xs underline">
                    Open Outreach Planner
                  </a>
                </label>
              )}
              <label className="block text-sm">
                Review note
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="What was verified for this reply or offer?"
                  className="mt-1 w-full rounded border p-2"
                />
              </label>
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I checked the full conversation, recipients, dates, terms and
                attachments for this event.
              </label>
              <button
                type="button"
                disabled={
                  busy ||
                  !checked ||
                  !reason.trim() ||
                  (intent === "specific_offer" && !hold.trim())
                }
                onClick={() => void send()}
                className="rounded bg-teal-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Send this approved email
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
