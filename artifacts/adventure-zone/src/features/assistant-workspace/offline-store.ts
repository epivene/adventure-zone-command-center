import { getAuthToken } from "@/lib/auth-token";
import type { Conversation, Draft, Rule } from "./types";
import { changeOfflineRecord, readOfflineRecord } from "./offline-db";

export type OfflineEdits = Pick<Draft["content"], "subject" | "html" | "text">;
export type OfflineDraft = {
  id: string;
  base: Draft;
  local: OfflineEdits | null;
  savedAt: number | null;
  conflict: Draft | null;
  syncState: "idle" | "uncertain";
  attempt?: { revision: string; edits: OfflineEdits } | null;
};
export type OfflineProfile = {
  id: string;
  name: string;
  details: Record<string, unknown>;
};
export type OfflineSnapshot = {
  conversation: Conversation;
  preparedAt: number;
  expiresAt: number;
  profiles: OfflineProfile[];
  rules: Rule[];
  drafts: OfflineDraft[];
};
export type OfflineWorkspace = { snapshots: OfflineSnapshot[] };
export type OfflineRecord = OfflineWorkspace & { digest: string };
export type OfflineBinding = {
  token: string;
  digest: string;
  expiresAt: number;
};
const lifetime = 7 * 86400000;
const accessError = () =>
  new Error(
    "This saved workspace is locked. Sign in and prepare it online again.",
  );

/** The raw token is used only in memory. Only its SHA-256 digest enters IndexedDB. */
export async function getOfflineBinding(): Promise<OfflineBinding> {
  const token = getAuthToken();
  const match = token && /^owner\.(\d+)\.([^.]+)$/.exec(token);
  const expiresAt = match ? Number(match[1]) : 0;
  if (!token || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
    throw accessError();
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure device storage is unavailable in this browser.");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const binding = {
    token,
    expiresAt,
    digest: Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
  assertOfflineBinding(binding);
  return binding;
}
export function assertOfflineBinding(binding: OfflineBinding) {
  if (getAuthToken() !== binding.token || binding.expiresAt <= Date.now())
    throw accessError();
}
export async function loadOfflineWorkspace(): Promise<OfflineWorkspace> {
  let binding: OfflineBinding;
  try {
    binding = await getOfflineBinding();
  } catch {
    return { snapshots: [] };
  }
  const record = await readOfflineRecord();
  try {
    assertOfflineBinding(binding);
  } catch {
    return { snapshots: [] };
  }
  if (!record || record.digest !== binding.digest) return { snapshots: [] };
  return {
    snapshots: record.snapshots
      .filter((snapshot) => snapshot.expiresAt > Date.now())
      .sort((a, b) => b.preparedAt - a.preparedAt),
  };
}
const pending = (snapshot: OfflineSnapshot) =>
  snapshot.drafts.some((draft) => draft.local || draft.attempt);
/** Called only after a successful online owner verification and shell preparation. */
export async function commitPreparedSnapshot(
  binding: OfflineBinding,
  input: Pick<OfflineSnapshot, "conversation" | "profiles" | "rules">,
): Promise<OfflineSnapshot> {
  assertOfflineBinding(binding);
  const snapshot = await changeOfflineRecord((existing) => {
    assertOfflineBinding(binding);
    const records =
      existing?.digest === binding.digest ? existing.snapshots : [];
    const previous = records.find(
      (saved) => saved.conversation.id === input.conversation.id,
    );
    const drafts = input.conversation.drafts.map((base): OfflineDraft => {
      const old = previous?.drafts.find((draft) => draft.id === base.id);
      return old && (old.local || old.attempt)
        ? old
        : {
            id: base.id,
            base,
            local: null,
            savedAt: null,
            conflict: null,
            syncState: "idle",
          };
    });
    // A server deletion must not silently remove unsynced local work.
    for (const old of previous?.drafts ?? [])
      if (
        (old.local || old.attempt) &&
        !drafts.some((draft) => draft.id === old.id)
      )
        drafts.push(old);
    const now = Date.now();
    const next: OfflineSnapshot = {
      ...input,
      preparedAt: now,
      expiresAt: Math.min(binding.expiresAt, now + lifetime),
      drafts,
    };
    const snapshots = records.filter(
      (saved) =>
        saved.conversation.id !== input.conversation.id &&
        (saved.expiresAt > now || pending(saved)),
    );
    while (snapshots.length >= 10) {
      const candidates = snapshots
        .filter((saved) => !pending(saved))
        .sort((a, b) => a.preparedAt - b.preparedAt);
      if (!candidates.length)
        throw new Error(
          "Ten saved conversations have unsynced drafts. Sync or explicitly clear local work before preparing another.",
        );
      snapshots.splice(snapshots.indexOf(candidates[0]), 1);
    }
    snapshots.push(next);
    return { record: { digest: binding.digest, snapshots }, value: next };
  });
  assertOfflineBinding(binding);
  return snapshot;
}
export async function updateOfflineDraft(
  conversationId: string,
  draftId: string,
  change: (draft: OfflineDraft) => OfflineDraft,
  binding?: OfflineBinding,
): Promise<OfflineDraft> {
  const owner = binding ?? (await getOfflineBinding());
  assertOfflineBinding(owner);
  const updated = await changeOfflineRecord((record) => {
    assertOfflineBinding(owner);
    if (!record || record.digest !== owner.digest) throw accessError();
    const snapshot = record.snapshots.find(
      (entry) =>
        entry.conversation.id === conversationId &&
        entry.expiresAt > Date.now(),
    );
    const index =
      snapshot?.drafts.findIndex((draft) => draft.id === draftId) ?? -1;
    if (!snapshot || index < 0) throw accessError();
    const draft = change(snapshot.drafts[index]);
    snapshot.drafts[index] = draft;
    return { record, value: draft };
  });
  assertOfflineBinding(owner);
  return updated;
}
export function validateOfflineEdits(edits: OfflineEdits): OfflineEdits {
  if (
    !edits.subject.trim() ||
    edits.subject.length > 300 ||
    /[\r\n]/.test(edits.subject) ||
    !edits.text.trim() ||
    edits.text.length > 30000 ||
    !edits.html.trim() ||
    edits.html.length > 150000
  )
    throw new Error(
      "Add a subject and email text. Keep the subject under 300 characters and email text under 30,000 characters.",
    );
  return { subject: edits.subject.trim(), html: edits.html, text: edits.text };
}
/** Compare the exact local copy an editor opened, even for same-millisecond saves. */
export function offlineDraftVersion(draft: OfflineDraft): string {
  const edits = (value: OfflineEdits | null | undefined) =>
    value ? [value.subject, value.html, value.text] : null;
  return JSON.stringify([
    draft.base.revision,
    draft.base.status,
    edits(draft.local),
    draft.savedAt,
    draft.conflict?.revision ?? null,
    draft.syncState,
    draft.attempt?.revision ?? null,
    edits(draft.attempt?.edits),
  ]);
}

function assertDraftVersion(draft: OfflineDraft, expected: string) {
  if (offlineDraftVersion(draft) !== expected)
    throw new Error(
      "The local draft changed in another tab. Copy your unsaved text, then cancel unsaved editing to reload the saved copy.",
    );
}

export async function saveOfflineDraft(
  conversationId: string,
  draftId: string,
  edits: OfflineEdits,
  expectedVersion: string,
): Promise<OfflineDraft> {
  const local = validateOfflineEdits(edits);
  return updateOfflineDraft(conversationId, draftId, (draft) => {
    assertDraftVersion(draft, expectedVersion);
    if (!["local", "saved"].includes(draft.base.status))
      throw new Error(
        "This draft cannot be edited. Its saved status requires an online review.",
      );
    return { ...draft, local, savedAt: Date.now() };
  });
}
export async function clearOfflineWorkspace(): Promise<void> {
  // No token required: logout must also clear an expired owner's data.
  if (typeof indexedDB === "undefined") return;
  await changeOfflineRecord(() => ({ record: null, value: undefined }));
}

/** Explicit user discard; this never updates the server. */
export async function discardOfflineDraft(
  conversationId: string,
  draftId: string,
  expectedVersion: string,
): Promise<OfflineDraft> {
  return updateOfflineDraft(conversationId, draftId, (draft) => {
    assertDraftVersion(draft, expectedVersion);
    return {
      ...draft,
      base: draft.conflict ?? draft.base,
      local: null,
      savedAt: null,
      conflict: null,
      attempt: null,
      syncState: "idle",
    };
  });
}
