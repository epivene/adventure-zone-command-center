import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  EditableEmailBody,
  type EditableEmailBodyHandle,
} from "@/components/assistant-workspace/EditableEmailBody";
import {
  loadOfflineWorkspace,
  saveOfflineDraft,
  offlineDraftVersion,
  discardOfflineDraft,
  type OfflineDraft,
  type OfflineWorkspace,
} from "@/features/assistant-workspace/offline-store";
import { syncOfflineDraft } from "@/features/assistant-workspace/offline-sync";
import { getAuthToken, onAuthChange } from "@/lib/auth-token";

const buttonClass =
  "min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";
const cardClass = "min-w-0 rounded-xl border border-slate-200 bg-white p-4";

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Device storage is unavailable. Please try again.";
}

function age(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function Details({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined || value === "")
    return <span>Not recorded</span>;
  if (Array.isArray(value))
    return value.length ? (
      <ul className="space-y-1">
        {value.map((item, index) => (
          <li key={index}>
            <Details value={item} />
          </li>
        ))}
      </ul>
    ) : (
      <span>None recorded</span>
    );
  if (typeof value === "object")
    return (
      <dl className="space-y-2">
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt className="text-sm font-medium text-slate-600">
              {key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")}
            </dt>
            <dd className="whitespace-pre-wrap break-words">
              <Details value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}

function LocalDraft({
  draft,
  conversationId,
  online,
  onUpdate,
  onDirty,
  onReload,
}: {
  draft: OfflineDraft;
  conversationId: string;
  online: boolean;
  onUpdate: (draft: OfflineDraft) => void;
  onDirty: (id: string, dirty: boolean) => void;
  onReload: () => Promise<void>;
}) {
  const source = draft.local ?? draft.base.content;
  const [subject, setSubject] = useState(source.subject);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const body = useRef<EditableEmailBodyHandle>(null);
  const [editorReset, setEditorReset] = useState(0);
  const editor = useRef({
    key: offlineDraftVersion(draft),
    version: offlineDraftVersion(draft),
    html: source.html,
  });
  if (!dirty && !busy) {
    editor.current = {
      key: offlineDraftVersion(draft),
      version: offlineDraftVersion(draft),
      html: source.html,
    };
  }
  const lock = useRef(false);
  const editable = ["local", "saved"].includes(draft.base.status);
  const markDirty = (value: boolean) => {
    setDirty(value);
    onDirty(draft.id, value);
  };
  useEffect(() => {
    if (!dirty && !busy) setSubject(source.subject);
  }, [source.subject, dirty, busy]);

  async function save() {
    if (!body.current || lock.current || !dirty || !editable) return;
    const content = body.current.getValue();
    if (
      !subject.trim() ||
      subject.length > 300 ||
      /[\r\n]/.test(subject) ||
      !content.text.trim() ||
      content.text.length > 30_000 ||
      content.html.length > 150_000
    ) {
      setError(
        "Add a subject and email text. Keep the subject under 300 characters and the email under 30,000 characters.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveOfflineDraft(
        conversationId,
        draft.id,
        {
          subject: subject.trim(),
          ...content,
        },
        editor.current.version,
      );
      markDirty(false);
      onUpdate(saved);
      setNotice(
        "Saved on this device. These edits have not been synced to the app or Gmail.",
      );
    } catch (failure) {
      setError(`${errorText(failure)} Your unsaved edits are still here.`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function sync() {
    if (
      lock.current ||
      !navigator.onLine ||
      !draft.local ||
      dirty ||
      draft.conflict ||
      !editable
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await syncOfflineDraft(conversationId, draft.id);
      onUpdate(result.draft);
      setNotice(
        result.status === "synced"
          ? "Draft changes synced to the app. Gmail was not changed and no email was sent."
          : "This draft changed elsewhere. Your saved local edits are retained below.",
      );
    } catch (failure) {
      setError(
        `${errorText(failure)} Saved local edits remain on this device.`,
      );
      await onReload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function discard() {
    if (
      lock.current ||
      !draft.local ||
      !window.confirm(
        "Discard the subject and body saved on this device, including any unsaved edits? The current server copy will be retained. This does not change the app or Gmail.",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const restored = await discardOfflineDraft(
        conversationId,
        draft.id,
        editor.current.version,
      );
      markDirty(false);
      onUpdate(restored);
      setNotice("Local changes discarded. The app and Gmail were not changed.");
    } catch (failure) {
      setError(`${errorText(failure)} Your local edits are still here.`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function cancelEditing() {
    if (
      lock.current ||
      !window.confirm(
        "Cancel unsaved editing and reload the copy saved on this device? Copy any text you want to keep first.",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await loadOfflineWorkspace();
      const current = saved.snapshots
        .find((item) => item.conversation.id === conversationId)
        ?.drafts.find((item) => item.id === draft.id);
      if (!current)
        throw new Error(
          "The saved draft is unavailable. Your unsaved edits are still here.",
        );
      onUpdate(current);
      markDirty(false);
      setEditorReset((value) => value + 1);
      setNotice("Reloaded the saved copy. No saved changes were deleted.");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className={cardClass}
      aria-label={`Saved draft: ${draft.base.content.subject}`}
    >
      <h3 className="font-semibold">Email draft</h3>
      <div className="my-3 space-y-1 break-words text-sm text-slate-600">
        <p>To: {draft.base.content.to.join(", ") || "None recorded"}</p>
        {!!draft.base.content.cc.length && (
          <p>Cc: {draft.base.content.cc.join(", ")}</p>
        )}
        <p>
          Attachment references:{" "}
          {draft.base.content.attachmentIds.join(", ") || "None"}. Files are not
          available offline.
        </p>
        <p>
          Recipients, attachment references and the email template are retained.
        </p>
      </div>
      <label className="block text-sm font-medium">
        Subject
        <input
          aria-label="Email subject"
          value={subject}
          maxLength={300}
          disabled={busy || !editable}
          onChange={(event) => {
            setSubject(event.target.value);
            markDirty(true);
            setNotice("");
          }}
          className="mb-3 mt-1 min-h-11 w-full rounded-lg border bg-white p-2 text-base"
        />
      </label>
      <p className="mb-2 text-sm text-slate-600">
        Tap the email text to edit. Choose Save on device when finished.
      </p>
      <div inert={busy || !editable ? true : undefined}>
        <EditableEmailBody
          ref={body}
          key={`${editor.current.key}:${editorReset}`}
          html={editor.current.html}
          onDirty={() => {
            markDirty(true);
            setNotice("");
          }}
          disabled={!editable}
        />
      </div>
      {!editable && (
        <p className="mt-2 text-sm">
          This draft is {draft.base.status} and cannot be edited here.
        </p>
      )}
      <p className="mt-3 text-sm text-slate-600">
        {dirty
          ? "Unsaved changes — save on this device before leaving."
          : draft.local
            ? `Saved on this device${draft.savedAt ? ` at ${new Date(draft.savedAt).toLocaleString()}` : ""}; waiting for explicit sync.`
            : "Prepared draft. No local changes waiting to sync."}
      </p>
      {draft.syncState === "uncertain" && (
        <p className="mt-2 text-sm text-amber-800">
          The last sync outcome is uncertain. Sync again when connected to check
          the current app draft safely.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={`${buttonClass} bg-teal-800 text-white`}
          disabled={busy || !dirty || !editable}
          onClick={() => void save()}
        >
          {busy ? "Working…" : "Save on device"}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={
            busy ||
            !online ||
            !draft.local ||
            dirty ||
            !!draft.conflict ||
            !editable
          }
          onClick={() => void sync()}
        >
          Sync draft changes
        </button>
        {dirty && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void cancelEditing()}
          >
            Cancel unsaved editing
          </button>
        )}
        {draft.local && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void discard()}
          >
            Discard local changes
          </button>
        )}
      </div>
      {!online && (
        <p className="mt-2 text-sm text-slate-600">
          Connect to the internet to sync saved changes.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-teal-800">
          {notice}
        </p>
      )}
      {draft.conflict && (
        <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold">
            Copy your local text and reconcile it in the online workspace before
            syncing again.
          </p>
          <label className="block text-sm">
            Your saved local subject
            <input
              aria-label="Your saved local subject"
              readOnly
              value={draft.local?.subject ?? ""}
              className="mt-1 min-h-11 w-full rounded border bg-white p-2"
            />
          </label>
          <label className="block text-sm">
            Your saved local text
            <textarea
              aria-label="Your saved local text"
              readOnly
              value={draft.local?.text ?? ""}
              rows={6}
              className="mt-1 w-full rounded border bg-white p-2 text-base"
            />
          </label>
          <h4 className="font-semibold">Current server draft</h4>
          <p className="break-words">{draft.conflict.content.subject}</p>
          <p className="whitespace-pre-wrap break-words">
            {draft.conflict.content.text}
          </p>
        </div>
      )}
    </section>
  );
}

export default function AssistantOfflinePage() {
  const [workspace, setWorkspace] = useState<OfflineWorkspace>({
    snapshots: [],
  });
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [dirtyDrafts, setDirtyDrafts] = useState<Set<string>>(new Set());
  const loadSequence = useRef(0);
  const unsaved = dirtyDrafts.size > 0;
  const snapshot =
    workspace.snapshots.find((item) => item.conversation.id === selected) ??
    workspace.snapshots[0];
  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const token = getAuthToken();
    // Expired records disappear before an asynchronous storage read can stall.
    setWorkspace((current) => ({
      snapshots: current.snapshots.filter(
        (item) => item.expiresAt > Date.now(),
      ),
    }));
    setLoading(true);
    setError("");
    try {
      const saved = await loadOfflineWorkspace();
      if (sequence !== loadSequence.current || token !== getAuthToken()) return;
      setWorkspace({
        snapshots: saved.snapshots.filter(
          (item) => item.expiresAt > Date.now(),
        ),
      });
      setSelected((id) =>
        saved.snapshots.some((item) => item.conversation.id === id)
          ? id
          : (saved.snapshots[0]?.conversation.id ?? ""),
      );
      if (!saved.snapshots.length) setDirtyDrafts(new Set());
    } catch (failure) {
      if (sequence !== loadSequence.current || token !== getAuthToken()) return;
      setError(errorText(failure));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const authChanged = () => {
      setWorkspace({ snapshots: [] });
      setSelected("");
      setDirtyDrafts(new Set());
      void reload();
    };
    const unsubscribe = onAuthChange(authChanged);
    const storageChanged = (event: StorageEvent) => {
      if (event.key === "az_owner_token" || event.key === null) authChanged();
    };
    const connectivityChanged = () => {
      setOnline(navigator.onLine);
      void reload();
    };
    window.addEventListener("storage", storageChanged);
    window.addEventListener("online", connectivityChanged);
    window.addEventListener("offline", connectivityChanged);
    return () => {
      ++loadSequence.current;
      unsubscribe();
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("online", connectivityChanged);
      window.removeEventListener("offline", connectivityChanged);
    };
  }, [reload]);
  useEffect(() => {
    if (!workspace.snapshots.length) return;
    const expiry = Math.min(
      ...workspace.snapshots.map((item) => item.expiresAt),
    );
    const timer = window.setTimeout(
      () => void reload(),
      Math.max(0, expiry - Date.now()) + 10,
    );
    return () => window.clearTimeout(timer);
  }, [workspace.snapshots, reload]);
  useEffect(() => {
    const available = new Set(
      workspace.snapshots.flatMap((item) =>
        item.drafts.map((draft) => draft.id),
      ),
    );
    setDirtyDrafts((current) => {
      const retained = new Set([...current].filter((id) => available.has(id)));
      return retained.size === current.size ? current : retained;
    });
  }, [workspace.snapshots]);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  const markDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyDrafts((current) => {
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return (
    <main className="min-h-dvh bg-slate-50 px-3 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Offline workspace</h1>
            <p className="mt-1 text-sm text-slate-600">
              Prepared records and email drafts on this device.
            </p>
          </div>
          <span className="rounded-full border bg-white px-3 py-2 text-sm">
            {online ? "Internet connected" : "Offline"}
          </span>
        </header>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p>
            Snapshots are historical. Balances, availability, insurance coverage
            and Gmail state may have changed.
          </p>
          <p className="mt-1">
            AI chat needs internet. Documents and images are not downloaded.
          </p>
          <p className="mt-1">
            Prepared copies can remain here after a conversation is archived or
            moved to Trash. Sync checks its current status online; restore the
            conversation before syncing drafts.
          </p>
        </div>
        <a
          href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/assistant/workspace${snapshot ? `/${encodeURIComponent(snapshot.conversation.id)}` : ""}`}
          aria-disabled={unsaved}
          onClick={(event) => {
            if (unsaved) event.preventDefault();
          }}
          className="inline-flex min-h-11 items-center rounded-lg border bg-white px-3 py-2 text-sm font-medium"
        >
          Open online workspace
        </a>
        {unsaved && (
          <p className="text-sm text-amber-800">
            Save your edits on this device before changing conversations or
            opening the online workspace.
          </p>
        )}
        {loading && !snapshot && <p role="status">Opening device storage…</p>}
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-white p-3 text-red-800"
          >
            <p>{error}</p>
            <button
              type="button"
              className={`${buttonClass} mt-2`}
              onClick={() => void reload()}
            >
              Try opening again
            </button>
          </div>
        )}
        {!loading && !error && !workspace.snapshots.length && (
          <section className={cardClass}>
            <h2 className="font-semibold">
              No prepared conversations available
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              While connected, sign in and choose Prepare for offline in the
              assistant. Prepared access expires after at most seven days and is
              removed when the owner session changes.
            </p>
          </section>
        )}
        {snapshot && (
          <>
            <label className="block text-sm font-medium">
              Prepared conversation
              <select
                aria-label="Prepared conversation"
                disabled={unsaved}
                value={snapshot.conversation.id}
                onChange={(event) => setSelected(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border bg-white p-2 text-base"
              >
                {workspace.snapshots.map((item) => (
                  <option
                    key={item.conversation.id}
                    value={item.conversation.id}
                  >
                    {item.conversation.title || "Untitled conversation"}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm text-slate-600">
              <p>
                Prepared {age(snapshot.preparedAt)} —{" "}
                {new Date(snapshot.preparedAt).toLocaleString()}
              </p>
              <p>
                Access expires {new Date(snapshot.expiresAt).toLocaleString()}.
              </p>
            </div>
            <section className="space-y-3" aria-label="Saved email drafts">
              <h2 className="text-lg font-semibold">Email drafts</h2>
              {!snapshot.drafts.length && (
                <p className="text-sm text-slate-600">
                  No email drafts were prepared for this conversation.
                </p>
              )}
              {snapshot.drafts.map((draft) => (
                <LocalDraft
                  key={`${snapshot.conversation.id}:${draft.id}`}
                  draft={draft}
                  conversationId={snapshot.conversation.id}
                  online={online}
                  onDirty={markDirty}
                  onReload={reload}
                  onUpdate={(updated) => {
                    // A read begun before this save must not replace its result.
                    ++loadSequence.current;
                    setLoading(false);
                    setWorkspace((current) => ({
                      snapshots: current.snapshots.map((item) =>
                        item.conversation.id === snapshot.conversation.id
                          ? {
                              ...item,
                              drafts: item.drafts.map((existing) =>
                                existing.id === updated.id ? updated : existing,
                              ),
                            }
                          : item,
                      ),
                    }));
                  }}
                />
              ))}
            </section>
            <section
              className={`${cardClass} space-y-4`}
              aria-label="Saved profiles"
            >
              <h2 className="text-lg font-semibold">Profile snapshots</h2>
              {!snapshot.profiles.length && (
                <p className="text-sm">No profile snapshots were prepared.</p>
              )}
              {snapshot.profiles.map((profile) => (
                <article key={profile.id} className="space-y-2">
                  <h3 className="font-semibold">{profile.name}</h3>
                  <Details value={profile.details} />
                </article>
              ))}
            </section>
            <section
              className={`${cardClass} space-y-4`}
              aria-label="Saved business rules"
            >
              <h2 className="text-lg font-semibold">Business rules</h2>
              {!snapshot.rules.length && (
                <p className="text-sm">No business rules were prepared.</p>
              )}
              {snapshot.rules.map((rule) => (
                <article key={rule.id}>
                  <h3 className="text-sm font-semibold">
                    {rule.sourceLabel || rule.ruleKey}
                  </h3>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {rule.body}
                  </p>
                </article>
              ))}
            </section>
            <section
              className={`${cardClass} space-y-4`}
              aria-label="Saved conversation"
            >
              <h2 className="text-lg font-semibold">Conversation snapshot</h2>
              {snapshot.conversation.messages.map((message) => (
                <article key={message.id}>
                  <h3 className="text-sm font-semibold">
                    {message.role === "user" ? "You" : "Assistant"}
                  </h3>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {message.text}
                  </p>
                  {!!message.attachments?.length && (
                    <p className="mt-1 text-xs text-slate-500">
                      Image references only:{" "}
                      {message.attachments
                        .map((item) => item.filename)
                        .join(", ")}
                    </p>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
