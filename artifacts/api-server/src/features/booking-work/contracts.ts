import { z } from "zod";
export const workStatuses = [
  "queued",
  "researching",
  "draft_ready",
  "waiting_desiree",
  "waiting_customer",
  "blocked",
  "completed",
  "cancelled",
] as const;
export const workQueues = [
  "new_leads",
  "replies",
  "followups",
  "paperwork",
  "routes",
] as const;
export const actorSchema = z
  .object({
    kind: z.enum(["owner", "connection"]),
    id: z.string().trim().min(1).max(200),
  })
  .strict();
export type WorkActor = z.infer<typeof actorSchema>;
const label = z.string().trim().min(1).max(200),
  recordId = z.string().uuid();
export const linkSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("email"),
      url: z
        .string()
        .url()
        .max(2000)
        .refine((v) => new URL(v).protocol === "https:"),
      label,
    })
    .strict(),
  z.object({ kind: z.literal("draft"), recordId, label }).strict(),
  z.object({ kind: z.literal("document"), recordId, label }).strict(),
  z.object({ kind: z.literal("followup"), recordId, label }).strict(),
]);
export const createWorkSchema = z
  .object({
    profileId: z.string().uuid(),
    eventYear: z.number().int().min(2000).max(2200),
    bookingId: z.string().uuid().nullable().optional(),
    queue: z.enum(workQueues),
    title: z.string().trim().min(1).max(300),
    nextAction: z.string().trim().min(1).max(2000),
  })
  .strict();
export const patchWorkSchema = z
  .object({
    status: z.enum(workStatuses).optional(),
    nextAction: z.string().trim().min(1).max(2000).optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    progress: z
      .object({
        completed: z.number().int().min(0),
        total: z.number().int().min(0),
        summary: z.string().max(2000),
      })
      .strict()
      .refine((p) => p.completed <= p.total)
      .nullable()
      .optional(),
    links: z.array(linkSchema).max(20).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0);
export const filterSchema = z
  .object({
    profileId: z.string().uuid().optional(),
    eventYear: z.number().int().min(2000).max(2200).optional(),
    status: z.enum(workStatuses).optional(),
    queue: z.enum(workQueues).optional(),
    actor: actorSchema.optional(),
    cursor: z.string().max(2000).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type CreateWork = z.infer<typeof createWorkSchema>;
export type PatchWork = z.infer<typeof patchWorkSchema>;
export type WorkFilter = z.infer<typeof filterSchema>;
export type WorkStatus = (typeof workStatuses)[number];
export type WorkActivity = CreateWork & {
  id: string;
  bookingId: string | null;
  assignedTo: WorkActor | null;
  status: WorkStatus;
  dueAt: string | null;
  progress: NonNullable<PatchWork["progress"]> | null;
  links: NonNullable<PatchWork["links"]>;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type WorkPage = { items: WorkActivity[]; nextCursor: string | null };
export const terminal = (s: WorkStatus) =>
  s === "completed" || s === "cancelled";
