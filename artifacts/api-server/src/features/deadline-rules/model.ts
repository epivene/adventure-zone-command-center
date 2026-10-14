import { z } from "zod";

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, "Use a real calendar date.");
export const offsets = z.array(z.number().int().min(0).max(3650)).max(10);
export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("deadline_before"), days: offsets.min(1), useItemOffsets: z.boolean().default(true) }).strict(),
  z.object({ type: z.literal("deadline_passed") }).strict(),
  z.object({ type: z.literal("inactive"), days: z.number().int().min(1).max(3650) }).strict(),
  z.object({ type: z.literal("status_changed"), status: z.string().trim().min(1).max(80).optional() }).strict(),
]);
export const ruleSchema = z.object({
  name: z.string().trim().min(1).max(160), enabled: z.boolean(),
  trigger: triggerSchema,
  actions: z.array(z.enum(["notify","badge","next_action","email"])).min(1).max(4),
}).strict();
export type Rule = z.infer<typeof ruleSchema> & { id: string; created_at: string | Date };
export type Deadline = {
  sourceKey: string; organizationId: string; profileName: string; kind: string;
  label: string; dueOn: string | null; offsets: number[] | null; completed: boolean;
  editable: boolean;
};
export function businessDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year:"numeric", month:"2-digit", day:"2-digit" }).format(now);
}
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/86400000);
}
export function deadlineMatch(rule: Rule, item: Deadline, today: string): string | null {
  if (!rule.enabled || item.completed || !item.dueOn) return null;
  const distance = daysBetween(today, item.dueOn);
  if (rule.trigger.type === "deadline_passed") return distance < 0 ? "overdue" : null;
  if (rule.trigger.type !== "deadline_before" || distance < 0) return null;
  const choices = rule.trigger.useItemOffsets ? item.offsets ?? rule.trigger.days : rule.trigger.days;
  // Catch up after sleeping, but do not generate every already-missed threshold.
  const threshold = [...new Set(choices)].sort((a,b)=>a-b).find(n => distance <= n);
  return threshold === undefined ? null : String(threshold);
}
