import { z } from "zod";
import { GmailDraftFilingService, draftFilingInput, draftFilingApplyInput } from "../chatgpt-connection/gmail-draft-filing-service";
import { transaction, type ConnectionDatabase } from "../chatgpt-connection/contracts";
import type { PostgresGoogleConnectionRepository } from "../google-workspace/google-connection-repository";
import type { ActionExecutor, MutationAdapter } from "./action-executor";
import type { ActionIntent, RunContext, ToolRegistry } from "./contracts";
import type { RunStore } from "./run-store";
import { stableCampaignId } from "./campaign-store";
import { blocked, result } from "./read-tools";
const schemas = {
  find_gmail_drafts: z.object({ query: z.string().trim().min(1).max(500) }).strict(),
  read_gmail_draft_filing: draftFilingInput,
  file_gmail_draft_to_profile: draftFilingApplyInput,
  read_email_filing_conflicts: z.object({ gmailConnectionId: z.uuid(), threadId: z.string().trim().min(1).max(200) }).strict(),
};
type Deps = {
  ownerId: string; db: ConnectionDatabase; service: GmailDraftFilingService;
  google: Pick<PostgresGoogleConnectionRepository, "getCurrent" | "createReadClient">;
};
function owner(deps: Deps, c: RunContext) {
  if (c.actor.id !== deps.ownerId || c.actor.role !== "owner" || c.signal.aborted)
    throw new Error("ASSISTANT_ACCESS_DENIED");
}
function selected(c: RunContext, profileId: string) {
  if (!c.selection.organizationIds.includes(profileId))
    throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
}
async function account(deps: Deps, c: RunContext) {
  owner(deps, c);
  const current = await deps.google.getCurrent();
  if (!current || current.id !== c.actor.connectionId) throw new Error("ASSISTANT_CONNECTION_CHANGED");
  return current.id;
}
function args(i: ActionIntent) {
  const a = draftFilingApplyInput.parse({ ...(i.arguments as object), expectedRevision: i.expectedRevision });
  if (i.targetId !== a.profileId) throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
  return a;
}
async function validate(deps: Deps, c: RunContext, i: ActionIntent) {
  const a = args(i); selected(c, a.profileId);
  const currentAccount = await account(deps, c);
  if (i.connectionId !== currentAccount) throw new Error("ASSISTANT_CONNECTION_CHANGED");
  const preview = await deps.service.previewCurrent({ draftId: a.draftId, profileId: a.profileId });
  if (preview.gmailConnectionId !== currentAccount) throw new Error("ASSISTANT_CONNECTION_CHANGED");
  if (preview.expectedRevision !== a.expectedRevision) throw new Error("ASSISTANT_DRAFT_VERSION_CONFLICT");
  if (preview.conflicts.some(m => m.profileId !== a.profileId)) throw new Error("EMAIL_ATTENTION_PROFILE_CONFLICT");
  return a;
}
export function gmailDraftFilingAdapter(deps: Deps): MutationAdapter {
  const output = (a: ReturnType<typeof args>, data: unknown) => ({
    ...result(data), receipts: [{ kind: "gmail_draft_filing", id: a.draftId,
      href: `/profiles/${a.profileId}`, verifiedAt: new Date().toISOString() }],
  });
  return {
    async validate(c, i) { await validate(deps, c, i); },
    async apply(c, i) {
      const a = await validate(deps, c, i);
      const saved = await transaction(deps.db, tx => deps.service.fileCurrent(tx, a));
      return output(a, saved.value);
    },
    async reconcile(c, i) {
      const a = await validate(deps, c, i);
      return output(a, await deps.service.verifyCurrent(a));
    },
  };
}
export function createGmailDraftFilingTools(deps: Deps & { runs: RunStore; executor: ActionExecutor }): ToolRegistry {
  return {
    definitions(c) {
      if (c.actor.id !== deps.ownerId || c.actor.role !== "owner") return [];
      return Object.entries(schemas).map(([name, schema]) => ({
        type: "function", name, strict: false, parameters: z.toJSONSchema(schema, { io: "input" }),
        description: name === "find_gmail_drafts"
          ? "Find current unsent Gmail drafts by an event-specific Gmail query. Returns stable draft IDs and current message/thread IDs. A nextPageToken means the result is incomplete; narrow the query, never claim an all-draft audit from a partial result."
          : name === "file_gmail_draft_to_profile"
          ? "File only the current unsent draft to the selected profile's mapped Profiles label. First read_gmail_draft_filing and the complete current Gmail thread, verify the event/profile match and use expectedRevision. Existing owner action grants/review apply. Does not send, archive, update attention/follow-ups or approve draft content. Stale edits require rereading."
          : name === "read_email_filing_conflicts"
          ? "Read exact stored profile associations when conversation filing reports a conflict. Check the complete thread and profiles before proposing a correction; do not merge or overwrite automatically."
          : "Preview current Gmail draft filing by stable draftId and selected profileId. Gmail edits can replace message IDs; use the returned current message/thread and exact revision. Read the complete current thread and verify its event/profile before filing. Preview is not content approval.",
      }));
    },
    async execute(c, call) {
      try {
        const currentAccount = await account(deps, c);
        const schema = schemas[call.name as keyof typeof schemas];
        if (!schema) return blocked("ASSISTANT_TOOL_UNKNOWN");
        let a: any;
        try { a = schema.parse(JSON.parse(call.arguments)); }
        catch { return blocked("ASSISTANT_ARGUMENTS_INVALID"); }
        if (call.name === "find_gmail_drafts") {
          const reader = await deps.google.createReadClient();
          if (!reader?.listGmailDrafts) return blocked("ASSISTANT_GMAIL_READ_UNAVAILABLE");
          const page = await reader.listGmailDrafts(a.query);
          if (await account(deps, c) !== currentAccount) return blocked("ASSISTANT_CONNECTION_CHANGED");
          return result({ ...page, gmailConnectionId: currentAccount, complete: !page.nextPageToken,
            instruction: page.nextPageToken ? "Incomplete result: narrow the event-specific query. Do not claim every draft was checked." : "Complete query result; this is not draft approval." });
        }
        if (call.name === "read_email_filing_conflicts") {
          if (a.gmailConnectionId !== currentAccount) return blocked("ASSISTANT_CONNECTION_CHANGED");
          return result(await deps.service.inspectCurrent(a));
        }
        selected(c, a.profileId);
        if (call.name === "read_gmail_draft_filing") {
          const preview = await deps.service.previewCurrent(a);
          if (preview.gmailConnectionId !== currentAccount) return blocked("ASSISTANT_CONNECTION_CHANGED");
          return result(preview);
        }
        const run = await deps.runs.get(c.actor.id, c.runId);
        if (!run || run.conversationId !== c.conversationId) return blocked("ASSISTANT_RUN_NOT_FOUND");
        return deps.executor.execute(c, {
          id: stableCampaignId(`${c.runId}:${call.id}`), actorId: c.actor.id,
          conversationId: c.conversationId, sourceMessageId: run.input.sourceMessageId,
          kind: "file_gmail_draft_to_profile", targetId: a.profileId,
          expectedRevision: a.expectedRevision, connectionId: currentAccount,
          arguments: { draftId: a.draftId, profileId: a.profileId },
        });
      } catch (e) {
        const code = e instanceof Error ? e.message : "";
        return blocked(/^(ASSISTANT_|CONNECTION_|EMAIL_ATTENTION_|GOOGLE_WORKSPACE_)/.test(code) ? code : "ASSISTANT_TOOL_FAILED");
      }
    },
  };
}
