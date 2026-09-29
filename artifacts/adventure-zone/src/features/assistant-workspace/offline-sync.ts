import { workspaceApi } from "./api";
import type { Conversation, Draft } from "./types";
import {
  assertOfflineBinding,
  getOfflineBinding,
  updateOfflineDraft,
  type OfflineDraft,
  type OfflineEdits,
} from "./offline-store";
const active = new Set<string>();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const same = (left: unknown, right: unknown) =>
  canonical(left) === canonical(right);
const changedInAnotherTab = () =>
  new Error("The local draft changed in another tab. Review it and sync again.");
function syncResult(
  draft: OfflineDraft,
): { status: "synced" | "conflict"; draft: OfflineDraft } {
  if (draft.conflict) return { status: "conflict", draft };
  if (draft.local || draft.attempt) throw changedInAnotherTab();
  return { status: "synced", draft };
}
function conflicted(
  current: OfflineDraft,
  observed: OfflineDraft,
  server: Draft,
): OfflineDraft {
  // A read or rejected PATCH can finish after another tab settled or edited
  // this draft. Only the unchanged state which prompted that request can gain
  // its conflict; otherwise leave the newer state intact for a fresh review.
  return same(current, observed) ? { ...current, conflict: server } : current;
}
function accepted(
  current: OfflineDraft,
  server: Draft,
  edits: OfflineEdits,
  expectedRevision: string,
): OfflineDraft {
  // Another tab may have already reconciled and saved a later revision while
  // this response was in flight. Its settled copy must never move backwards.
  if (
    !same(current.attempt, { revision: expectedRevision, edits }) ||
    (current.base.revision !== expectedRevision &&
      current.base.revision !== server.revision)
  )
    return current;
  return {
    ...current,
    base: server,
    local: same(current.local, edits) ? null : current.local,
    conflict: null,
    attempt: null,
    syncState: "idle",
  };
}
/** Only called from a deliberate user action. No Gmail or sending endpoint is used. */
export async function syncOfflineDraft(
  conversationId: string,
  draftId: string,
): Promise<{ status: "synced" | "conflict"; draft: OfflineDraft }> {
  const key = `${conversationId}:${draftId}`;
  if (active.has(key)) throw new Error("This draft is already syncing.");
  active.add(key);
  try {
    const binding = await getOfflineBinding();
    let draft = await updateOfflineDraft(
      conversationId,
      draftId,
      (current) => current,
      binding,
    );
    if (!draft.local) return { status: "synced", draft };
    const readServer = async () => {
      assertOfflineBinding(binding);
      const result = await workspaceApi<Conversation>(
        `/conversations/${encodeURIComponent(conversationId)}`,
      );
      assertOfflineBinding(binding);
      if (result.lifecycle === "archived" || result.lifecycle === "trashed")
        throw new Error(
          "Restore this conversation before syncing its saved drafts.",
        );
      const server = result.drafts.find((item) => item.id === draftId);
      if (!server)
        throw new Error(
          "The server draft is unavailable. Your local edits are still saved for copying.",
        );
      return server;
    };
    const server = await readServer();
    // Persisted attempt survives reload or a failed response. Reconcile its entire
    // content (including recipients and attachment metadata) before any new PATCH.
    if (
      draft.attempt &&
      ["local", "saved"].includes(server.status) &&
      same(server.content, { ...draft.base.content, ...draft.attempt.edits })
    ) {
      const attempt = draft.attempt;
      draft = await updateOfflineDraft(
        conversationId,
        draftId,
        (current) => accepted(current, server, attempt.edits, attempt.revision),
        binding,
      );
      if (!draft.local) return { status: "synced", draft };
    }
    if (
      server.revision !== draft.base.revision ||
      !["local", "saved"].includes(server.status)
    ) {
      draft = await updateOfflineDraft(
        conversationId,
        draftId,
        (current) => conflicted(current, draft, server),
        binding,
      );
      return syncResult(draft);
    }
    const edits = draft.local!;
    const revision = draft.base.revision;
    // This commit must finish before the request: a crashed tab then knows that
    // the server may have accepted the edit and must be checked on the next try.
    const attempted = await updateOfflineDraft(
      conversationId,
      draftId,
      (current) => {
        if (current.base.revision !== revision || !same(current.local, edits))
          throw changedInAnotherTab();
        return {
          ...current,
          attempt: { revision, edits },
          syncState: "uncertain",
        };
      },
      binding,
    );
    assertOfflineBinding(binding);
    let updated: Draft;
    try {
      updated = await workspaceApi<Draft>(
        `/drafts/${encodeURIComponent(draftId)}`,
        "PATCH",
        { revision, ...edits },
      );
    } catch (error) {
      if (error instanceof Error && /CONFLICT/.test(error.message)) {
        const latest = await readServer();
        draft = await updateOfflineDraft(
          conversationId,
          draftId,
          (current) =>
            ["local", "saved"].includes(latest.status) &&
            same(latest.content, { ...attempted.base.content, ...edits })
              ? accepted(current, latest, edits, revision)
              : conflicted(current, attempted, latest),
          binding,
        );
        return syncResult(draft);
      }
      throw error;
    }
    assertOfflineBinding(binding);
    if (
      !updated ||
      updated.id !== draftId ||
      !updated.revision ||
      !updated.content
    )
      throw new Error(
        "The sync response was incomplete. Your local edits are saved; reconnect and sync to check the result.",
      );
    draft = await updateOfflineDraft(
      conversationId,
      draftId,
      (current) => accepted(current, updated, edits, revision),
      binding,
    );
    return syncResult(draft);
  } finally {
    active.delete(key);
  }
}
