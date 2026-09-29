import { z } from "zod";
import type { ProviderCostCall } from "./usage-cost";
import type { ConversationMemory } from "./conversation-context";
export const selectionSchema = z
  .object({
    organizationIds: z.array(z.string().uuid()).max(100),
    batchId: z.string().uuid().nullable().optional(),
    bookingId: z.string().uuid().nullable(),
    threadId: z.string().min(1).max(256).nullable(),
    draftId: z.string().min(1).max(256).nullable(),
    eventYear: z.number().int().min(2000).max(2200).nullable(),
  })
  .strict();
export type Selection = z.infer<typeof selectionSchema>;
export const emptySelection = (): Selection => ({
  organizationIds: [],
  bookingId: null,
  threadId: null,
  draftId: null,
  eventYear: null,
});
export type Actor = { id: string; role: "owner"; connectionId: string | null };
export type Screenshot = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
};
export type AttachmentScope = {
  actorId: string;
  conversationId: string;
  sourceMessageId: string;
};
export type Turn = {
  role: "user" | "assistant";
  text: string;
  attachments?: Screenshot[];
};
export type Evidence = {
  id: string;
  kind: "profile" | "email" | "document" | "calendar" | "rule" | "web";
  recordId: string;
  eventYear: number | null;
  occurredAt: string | null;
  retrievedAt: string;
  version: string | null;
  complete: boolean;
  text: string;
};
export type Receipt = {
  kind: string;
  id: string;
  href: string;
  verifiedAt: string;
};
export type ToolResult = {
  costCalls?: ProviderCostCall[];
  screenshots?: Screenshot[];
  usageUnknown?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  status: "ok" | "partial" | "blocked" | "uncertain" | "failed";
  data: unknown;
  evidence: Evidence[];
  receipts: Receipt[];
  code: string | null;
};
export type ToolCall = { id: string; name: string; arguments: string };
export type Grant = {
  actorId: string;
  sourceMessageId: string;
  actionKind: string;
  targetIds: string[];
  revision: string | null;
  connectionId: string | null;
};
export type RunContext = {
  taskId?: string;
  taskReview?: boolean;
  taskVersion?: number;
  toolCallId?: string;
  actor: Actor;
  conversationId: string;
  runId: string;
  selection: Selection;
  grants: Grant[];
  signal: AbortSignal;
};
export type ActionIntent = {
  id: string;
  conversationId: string;
  actorId: string;
  kind: string;
  targetId: string;
  expectedRevision: string | null;
  connectionId: string | null;
  arguments: unknown;
  sourceMessageId: string;
};
export type ModelInput = {
  spendingScope?: {
    actorId: string;
    conversationId: string;
    runId: string;
    callId: string;
  };
  attachmentScope?: AttachmentScope;
  screenshots?: Screenshot[];
  memory?: ConversationMemory;
  instructions: string;
  turns: Turn[];
  state: Selection;
  evidence: Evidence[];
  providerItems: unknown[];
  toolDefinitions: unknown[];
  signal: AbortSignal;
};
export type ModelStep = {
  costCall?: ProviderCostCall;
  text: string;
  calls: ToolCall[];
  providerItems: unknown[];
  inputTokens: number;
  outputTokens: number;
};
export interface ModelPort {
  next(input: ModelInput): Promise<ModelStep>;
}
export interface ToolRegistry {
  definitions(context: RunContext): unknown[];
  execute(context: RunContext, call: ToolCall): Promise<ToolResult>;
}
export interface Queryable {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
