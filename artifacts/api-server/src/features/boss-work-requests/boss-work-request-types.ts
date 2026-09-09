import { z } from "zod";

export const requestTypeSchema = z.enum(["rapid_convention_notes", "email_template_approval"]);
export const requestStateSchema = z.enum([
  "waiting_on_dave", "in_progress", "submitted_to_owner", "changes_requested",
  "returned_for_clarification", "approved", "applied", "cancelled",
]);
export const requestPrioritySchema = z.enum(["normal", "high", "urgent"]);

export const conventionNotesSchema = z.object({
  eventName: z.string().trim().min(1).max(240),
  organizationName: z.string().trim().max(240).optional(),
  contactName: z.string().trim().max(240).optional(),
  email: z.string().trim().email().max(320).optional().or(z.literal("")),
  phone: z.string().trim().max(80).optional(),
  city: z.string().trim().max(160).optional(),
  state: z.string().trim().max(80).optional(),
  eventDate: z.string().trim().max(40).optional(),
  packageInterest: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  personalDetails: z.string().trim().max(4000).optional(),
  nextStep: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(12000).optional(),
}).strict();

export const conventionDraftSchema = z.object({
  clientRevision: z.number().int().min(0),
  payload: conventionNotesSchema.partial().extend({ eventName: z.string().trim().max(240).default("") }),
}).strict();

export const conventionSubmissionSchema = z.object({
  clientMutationId: z.string().uuid(),
  payload: conventionNotesSchema,
}).strict();

export const templateDecisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  note: z.string().trim().max(12000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "changes_requested" && !value.note) {
    context.addIssue({ code: "custom", path: ["note"], message: "Please explain the requested changes." });
  }
});

export const createWorkRequestSchema = z.object({
  type: requestTypeSchema,
  assignedBossAccountId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  instructions: z.string().trim().max(12000).nullable().optional(),
  priority: requestPrioritySchema.default("normal"),
  dueAt: z.string().datetime().nullable().optional(),
  deduplicationKey: z.string().trim().max(240).nullable().optional(),
  templateId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (value.type === "email_template_approval" && !value.templateId) {
    context.addIssue({ code: "custom", path: ["templateId"], message: "A template is required." });
  }
});

export const ownerDecisionSchema = z.object({
  note: z.string().trim().max(12000).nullable().optional(),
}).strict();

export const conventionApplySchema = z.object({
  organizationId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  createOrganization: z.boolean().default(false),
  createContact: z.boolean().default(false),
  followUpDueAt: z.string().datetime().nullable().optional(),
}).strict();
