import { z } from "zod";
export const selectionSchema = z
  .object({
    organizationIds: z.array(z.string().uuid()).max(100),
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
export type Turn = { role: "user" | "assistant"; text: string };
export type Evidence = {
  id: string;
  kind: "profile" | "email" | "document" | "calendar" | "rule";
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
  instructions: string;
  turns: Turn[];
  state: Selection;
  evidence: Evidence[];
  providerItems: unknown[];
  toolDefinitions: unknown[];
  signal: AbortSignal;
};
export type ModelStep = {
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
