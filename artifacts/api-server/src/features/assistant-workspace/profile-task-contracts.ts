import { z } from "zod";
export const taskScopeSchema = z
  .object({
    profileIds: z
      .array(z.string().uuid())
      .min(1)
      .max(1000)
      .refine((a) => new Set(a).size === a.length),
    eventYear: z.number().int().min(2000).max(2200).nullable(),
    completionMode: z
      .enum(["manual", "sourced_notes", "profile_fields"])
      .optional(),
    objective: z.string().trim().min(1).max(2000),
    requestedFields: z.array(z.string().min(1).max(80)).max(12),
    taskCapUsd: z.number().min(0).max(1000).nullable(),
  })
  .strict();
export type TaskScope = z.infer<typeof taskScopeSchema>;
export const taskAuthoritySchema = z
  .object({
    sourceMessageId: z.string().uuid(),
    actionKinds: z.array(z.string()).max(12),
    allowedFields: z.array(z.string()).max(12),
    profileIds: z.array(z.string().uuid()).max(1000),
  })
  .strict();
export type TaskAuthority = z.infer<typeof taskAuthoritySchema>;
export type TaskState =
  | "proposed"
  | "running"
  | "paused"
  | "waiting_review"
  | "completed"
  | "cancelled";
export type ItemState =
  | "pending"
  | "researching"
  | "ready_to_save"
  | "awaiting_review"
  | "completed"
  | "needs_review"
  | "failed"
  | "uncertain";
export type TaskCommand = "pause" | "resume" | "cancel" | "retry" | "skip";
export type TaskCounts = {
  total: number;
  completed: number;
  needsReview: number;
  failed: number;
  remaining: number;
};
export type TaskItem = {
  id: string;
  taskId: string;
  profileId: string;
  profileNameSnapshot?: string;
  eventYear: number | null;
  state: ItemState;
  attempts: number;
  reason: string | null;
  evidenceIds: string[];
  receiptIds: string[];
  actionIds: string[];
};
export type Task = {
  id: string;
  actorId: string;
  conversationId: string;
  sourceMessageId: string;
  scope: TaskScope;
  authority: TaskAuthority;
  state: TaskState;
  version: number;
  pauseReason: string | null;
  counts: TaskCounts;
  items: TaskItem[];
};
export type TaskOutcome = {
  itemId: string;
  state: ItemState;
  evidenceIds: string[];
  receiptIds: string[];
  reason: string | null;
  actionIds?: string[];
};
