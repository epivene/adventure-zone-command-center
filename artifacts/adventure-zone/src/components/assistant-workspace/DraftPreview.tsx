import { useEffect, useRef, useState } from "react";
import {
  EditableEmailBody,
  type EditableEmailBodyHandle,
} from "./EditableEmailBody";
import type { Draft } from "@/features/assistant-workspace/types";
export type DraftEdits = { subject: string; html: string; text: string };
export function DraftPreview({
  draft,
  onRevise,
  onSave,
  onReviewSend,
  onEdit,
  onEditingChange,
  busy,
}: {
  draft: Draft;
  onRevise: () => void;
  onSave: () => void;
  onReviewSend?: () => void;
  onEdit?: (draft: Draft, changes: DraftEdits) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [subject, setSubject] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const body = useRef<EditableEmailBodyHandle>(null);
  const saveLock = useRef(false);
  const editable = ["local", "saved"].includes(draft.status);
  const stale = !!editing && editing.revision !== draft.revision;
  useEffect(() => {
    if (!dirty || !editing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, editing]);
  function startEditing() {
    if (!onEdit || busy || !editable) return;
    setEditing(draft);
    setSubject(draft.content.subject);
    setDirty(false);
    setError("");
    setNotice("");
    onEditingChange?.(true);
  }
  function finishEditing() {
    setEditing(null);
    setDirty(false);
    setError("");
    onEditingChange?.(false);
  }
  async function saveChanges() {
    if (
      !editing ||
      !onEdit ||
      !body.current ||
      saveLock.current ||
      busy ||
      !editable ||
      stale
    )
      return;
    const content = body.current.getValue();
    if (
      !subject.trim() ||
      subject.length > 300 ||
      /[\r\n]/.test(subject) ||
      !content.text.trim() ||
      content.text.length > 30000 ||
      content.html.length > 150000
    ) {
      setError(
        "Add a subject and email text. Keep the subject under 300 characters and the email under 30,000 characters.",
      );
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      await onEdit(editing, { subject: subject.trim(), ...content });
      finishEditing();
      setNotice(
        "Changes saved in the app. Save in Gmail to update the Gmail draft.",
      );
    } catch (e) {
      setError(
        e instanceof Error && /CONFLICT|CHANGED/.test(e.message)
          ? "This draft changed elsewhere. Your edits are still here. Copy any text you need, then cancel and reopen the latest draft."
          : "Changes could not be saved. Your edits are still here; try again.",
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
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
      {editing ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Subject
            <input
              aria-label="Email subject"
              value={subject}
              maxLength={300}
              disabled={saving}
              onChange={(event) => {
                setSubject(event.target.value);
                setDirty(true);
              }}
              className="mt-1 min-h-11 w-full rounded-lg border bg-white p-2 text-base"
            />
          </label>
          <p className="text-sm text-slate-600">
            Tap the email text to edit it. Your template and recipients stay in
            place.
          </p>
          <EditableEmailBody
            ref={body}
            html={editing.content.html}
            onDirty={() => setDirty(true)}
            disabled={saving}
          />
          {(stale || !editable) && (
            <p role="alert" className="text-sm text-amber-800">
              The saved draft changed or is being processed. Your edits are
              still here. Copy any text you need, then cancel and reopen the
              latest draft.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-800">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveChanges()}
              disabled={saving || busy || !editable || stale || !dirty}
              className="min-h-11 rounded-lg bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving changes…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={finishEditing}
              disabled={saving}
              className="min-h-11 rounded-lg border px-3 py-2 text-sm"
            >
              Cancel edits
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <iframe
            title={`Preview: ${draft.content.subject}`}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={draft.content.html}
            className="h-96 w-full rounded-lg border bg-white"
          />
          {onEdit && editable && (
            <button
              type="button"
              onClick={startEditing}
              disabled={busy}
              aria-label="Edit email preview"
              className="absolute bottom-2 right-2 min-h-11 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              Tap to edit
            </button>
          )}
        </div>
      )}
      {notice && !editing && (
        <p role="status" className="mt-3 text-sm text-teal-800">
          {notice}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRevise}
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={busy || !!editing || !editable}
        >
          Revise with assistant
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-lg bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy || !!editing || !editable}
        >
          Save in Gmail
        </button>
        {onReviewSend && (
          <button
            type="button"
            onClick={onReviewSend}
            disabled={busy || !!editing || draft.status !== "saved"}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            Review before sending
          </button>
        )}
      </div>
    </section>
  );
}
