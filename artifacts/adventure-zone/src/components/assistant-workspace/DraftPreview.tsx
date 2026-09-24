import type { Draft } from "@/features/assistant-workspace/types";
export function DraftPreview({
  draft,
  onRevise,
  onSave,
  onReviewSend,
  busy,
}: {
  draft: Draft;
  onRevise: () => void;
  onSave: () => void;
  onReviewSend?: () => void;
  busy: boolean;
}) {
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4"
      aria-label="Email draft"
    >
      <div className="flex justify-between gap-2">
        <h3 className="font-semibold">{draft.content.subject}</h3>
        <span className="text-xs text-slate-500">
          {draft.status === "saved"
            ? "Saved in Gmail"
            : draft.status === "sent"
              ? "Sent"
              : draft.status === "uncertain"
                ? "Checking Gmail"
                : "In-app draft"}
        </span>
      </div>
      <dl className="my-3 space-y-1 text-sm">
        <div>
          <dt className="inline font-medium">To: </dt>
          <dd className="inline break-words">{draft.content.to.join(", ")}</dd>
        </div>
        {draft.content.cc.length > 0 && (
          <div>
            <dt className="inline font-medium">Cc: </dt>
            <dd className="inline">{draft.content.cc.join(", ")}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-medium">Conversation: </dt>
          <dd className="inline">
            {draft.content.threadId
              ? "Reply in existing Gmail thread"
              : "New email"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Attachments: </dt>
          <dd className="inline">{draft.content.attachmentIds.length}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Template version: </dt>
          <dd className="inline">
            {draft.content.templateVersion ?? "Not selected"}
          </dd>
        </div>
      </dl>
      <iframe
        title={`Preview: ${draft.content.subject}`}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={draft.content.html}
        className="h-96 w-full rounded-lg border bg-white"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRevise}
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={busy || draft.status === "sent"}
        >
          Revise with assistant
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-lg bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={
            busy ||
            ["sent", "uncertain", "saving", "sending"].includes(draft.status)
          }
        >
          Save in Gmail
        </button>
        {onReviewSend && (
          <button
            type="button"
            onClick={onReviewSend}
            disabled={busy || draft.status !== "saved"}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            Review before sending
          </button>
        )}
      </div>
    </section>
  );
}
