import { useEffect, useRef, useState } from "react";
import type { ProfileTaskChange } from "@/features/assistant-workspace/types";
const value = (v: unknown) =>
  v === null || v === ""
    ? "Empty"
    : typeof v === "string"
      ? v
      : JSON.stringify(v);
export function ProfileTaskReview({
  taskId,
  changes,
  onApprove,
  onSkip,
  disabled = false,
}: {
  taskId: string;
  changes: ProfileTaskChange[];
  onApprove: (changes: ProfileTaskChange[]) => Promise<void>;
  onSkip: (itemIds: string[]) => Promise<void>;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<Record<string, string | null>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    setSelected((old) =>
      Object.fromEntries(
        Object.entries(old).filter(([id, revision]) =>
          changes.some(
            (c) => c.actionId === id && c.revision === revision && c.available,
          ),
        ),
      ),
    );
  }, [changes, taskId]);
  const chosen = changes.filter(
    (c) =>
      Object.hasOwn(selected, c.actionId) &&
      selected[c.actionId] === c.revision,
  );
  async function act(skip = false) {
    if (pending.current || disabled || !chosen.length) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (skip) await onSkip([...new Set(chosen.map((c) => c.itemId))]);
      else await onApprove(chosen);
      setSelected({});
    } catch {
      setError(
        "These changes need refreshed information. Review the current values before approving again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Review task changes"
      className="min-w-0 rounded-xl border bg-white p-3 text-sm"
    >
      <h3 className="font-semibold">Review task changes</h3>
      <p>
        Select up to four changes. Approval applies only to the versions shown.
      </p>
      <div className="mt-3 space-y-3">
        {changes.map((c) => (
          <div key={c.actionId} className="min-w-0 rounded-lg border p-3">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={
                  Object.hasOwn(selected, c.actionId) &&
                  selected[c.actionId] === c.revision
                }
                disabled={
                  busy ||
                  disabled ||
                  !c.available ||
                  (chosen.length >= 4 && !Object.hasOwn(selected, c.actionId))
                }
                onChange={(e) =>
                  setSelected((old) => {
                    const next = { ...old };
                    if (e.target.checked) next[c.actionId] = c.revision;
                    else delete next[c.actionId];
                    return next;
                  })
                }
              />
              {c.profileName}
            </label>
            {c.fields.map((f) => (
              <dl key={f.field} className="mt-2 break-words">
                <dt className="font-medium">{f.field}</dt>
                <dd>Current: {value(f.oldValue)}</dd>
                <dd>Proposed: {value(f.newValue)}</dd>
              </dl>
            ))}
            {c.sources.length ? (
              <ul>
                {c.sources.map((url) => (
                  <li key={url}>
                    <a
                      className="break-all underline"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source: {url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-slate-600">
                No source link attached to this change. Check the research
                before approving.
              </p>
            )}
            {!c.available && (
              <p>
                {c.conflict ??
                  "Profile unavailable; this change cannot be approved."}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="min-h-[44px] rounded-lg border px-3 disabled:opacity-50"
          disabled={busy || disabled || !chosen.length}
          onClick={() => void act()}
        >
          Approve selected ({chosen.length})
        </button>
        <button
          className="min-h-[44px] rounded-lg border px-3 disabled:opacity-50"
          disabled={busy || disabled || !chosen.length}
          onClick={() => void act(true)}
        >
          Skip selected
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
