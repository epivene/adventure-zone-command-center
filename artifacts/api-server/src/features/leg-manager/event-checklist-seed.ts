import { eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  eventChecklistTemplateItems,
  eventChecklistTemplates,
} from "@/db/schema";

export type ChecklistSeedItem = {
  code: string;
  label: string;
  applicabilityTags: readonly string[];
  safetyCritical: boolean;
};

export const CHECKLIST_RESULT_GUIDANCE = {
  acceptable: "Acceptable — the item is safe and acceptable for operation or load-out.",
  needs_work_safe:
    "Needs work, but safe — document what needs attention; the item is still safe to operate unless another unsafe condition exists.",
  unsafe:
    "Unsafe — cannot operate. Document the problem, take a photo when practical, and keep the affected attraction out of service until it is cleared.",
  not_applicable:
    "Not applicable — use only when the checklist item genuinely does not apply; safety-critical items require an explanation.",
} as const;

export const PRE_EVENT_RESOURCE_ITEMS: readonly ChecklistSeedItem[] = [
  {
    code: "ride_surface_damage",
    label:
      "Inspect the entire inflatable for holes or damage, especially stairways. Holes larger than a quarter must be repaired before operation.",
    applicabilityTags: ["inflatable"],
    safetyCritical: true,
  },
  {
    code: "safety_signage",
    label: "Verify required safety signage is attached to the attraction.",
    applicabilityTags: ["inflatable"],
    safetyCritical: true,
  },
  {
    code: "blower_nozzle",
    label: "Verify each blower nozzle is securely attached to its blower.",
    applicabilityTags: ["blower_powered"],
    safetyCritical: true,
  },
  {
    code: "power_cords",
    label:
      "Inspect blower and extension cords. Verify cord-to-cord connections are knotted or otherwise secured as required before operation.",
    applicabilityTags: ["blower_powered"],
    safetyCritical: true,
  },
  {
    code: "anchor_each_point",
    label:
      "Verify every anchoring point has the required stake or an approved 350+ lb weight/ballast attached.",
    applicabilityTags: ["inflatable"],
    safetyCritical: true,
  },
  {
    code: "hook_stakes",
    label: "Verify hook stakes are flush with the ground where hook stakes are used.",
    applicabilityTags: ["inflatable"],
    safetyCritical: true,
  },
  {
    code: "straight_stakes",
    label:
      "Verify straight stakes are vertical, have no more than 12 inches exposed above ground, and have a cone or tennis ball covering the top.",
    applicabilityTags: ["inflatable"],
    safetyCritical: true,
  },
  {
    code: "sections_attached",
    label: "Verify inflatable sections are securely attached together.",
    applicabilityTags: ["multi_section"],
    safetyCritical: true,
  },
  {
    code: "straps_anchor_wear",
    label: "Inspect straps and anchoring points for security and excessive wear.",
    applicabilityTags: ["inflatable"],
    safetyCritical: true,
  },
] as const;

export const PRE_EVENT_SITE_ITEMS: readonly ChecklistSeedItem[] = [
  {
    code: "walkway_cords_matted",
    label: "Verify cords crossing walkways are properly covered or matted.",
    applicabilityTags: [],
    safetyCritical: true,
  },
  {
    code: "walkways_clear",
    label: "Verify walkways are clear and free from obstruction.",
    applicabilityTags: [],
    safetyCritical: true,
  },
  {
    code: "loose_items_garbage",
    label: "Remove loose items and garbage inside and around attractions.",
    applicabilityTags: [],
    safetyCritical: false,
  },
  {
    code: "mats_flat",
    label: "Verify all mats are lying flat and straight.",
    applicabilityTags: [],
    safetyCritical: true,
  },
  {
    code: "site_anchoring_method",
    label:
      "Confirm the anchoring method is appropriate for the event surface and setup area.",
    applicabilityTags: [],
    safetyCritical: true,
  },
] as const;

export const POST_EVENT_RESOURCE_ITEMS: readonly ChecklistSeedItem[] = [
  {
    code: "new_damage",
    label:
      "Inspect for new holes, tears, seam damage, or other damage after operation.",
    applicabilityTags: ["inflatable"],
    safetyCritical: true,
  },
  {
    code: "anchor_hardware_complete",
    label:
      "Confirm stakes, ballast hardware, straps, and attachment hardware are accounted for before loading.",
    applicabilityTags: ["inflatable"],
    safetyCritical: false,
  },
  {
    code: "blower_condition",
    label:
      "Inspect blowers, blower cords, and extension cords for damage before packing.",
    applicabilityTags: ["blower_powered"],
    safetyCritical: false,
  },
  {
    code: "sections_complete",
    label:
      "Confirm all sections and removable pieces are present and ready for load-out.",
    applicabilityTags: ["multi_section"],
    safetyCritical: false,
  },
  {
    code: "cleaning_drying",
    label:
      "Record whether the attraction needs additional cleaning or drying before storage or its next event.",
    applicabilityTags: ["inflatable"],
    safetyCritical: false,
  },
  {
    code: "resource_ready_next_event",
    label:
      "Confirm whether this assigned resource is safe and ready for its next assignment.",
    applicabilityTags: [],
    safetyCritical: true,
  },
] as const;

export const POST_EVENT_SITE_ITEMS: readonly ChecklistSeedItem[] = [
  {
    code: "site_cleanup",
    label:
      "Confirm Adventure Zone equipment, loose items, and garbage have been cleared from the operating area.",
    applicabilityTags: [],
    safetyCritical: false,
  },
  {
    code: "missing_equipment",
    label: "Confirm no Adventure Zone equipment or components are missing from load-out.",
    applicabilityTags: [],
    safetyCritical: true,
  },
  {
    code: "site_damage_note",
    label:
      "Record any event-site damage or condition that needs owner/admin follow-up.",
    applicabilityTags: [],
    safetyCritical: false,
  },
] as const;

type Database = typeof database;

async function ensureTemplate(
  database: Database,
  input: {
    code: string;
    name: string;
    phase: "pre_event" | "post_event";
    siteItems: readonly ChecklistSeedItem[];
    resourceItems: readonly ChecklistSeedItem[];
  },
) {
  await database
    .insert(eventChecklistTemplates)
    .values({
      code: input.code,
      name: input.name,
      phase: input.phase,
      version: 1,
      active: true,
    })
    .onConflictDoNothing({ target: eventChecklistTemplates.code });

  const template = (
    await database
      .select({ id: eventChecklistTemplates.id })
      .from(eventChecklistTemplates)
      .where(eq(eventChecklistTemplates.code, input.code))
      .limit(1)
  )[0];
  if (!template) throw new Error(`CHECKLIST_TEMPLATE_MISSING:${input.code}`);

  const items = [
    ...input.siteItems.map((item) => ({ ...item, scope: "site" as const })),
    ...input.resourceItems.map((item) => ({ ...item, scope: "resource" as const })),
  ];
  for (const [index, item] of items.entries()) {
    await database
      .insert(eventChecklistTemplateItems)
      .values({
        templateId: template.id,
        code: item.code,
        label: item.label,
        scope: item.scope,
        applicabilityTags: [...item.applicabilityTags],
        safetyCritical: item.safetyCritical,
        sortOrder: (index + 1) * 10,
        active: true,
      })
      .onConflictDoNothing({
        target: [eventChecklistTemplateItems.templateId, eventChecklistTemplateItems.code],
      });
  }
}

export async function ensureEventChecklistTemplates(database: Database): Promise<void> {
  await ensureTemplate(database, {
    code: "pre_event_v1",
    name: "Pre-event safety checklist",
    phase: "pre_event",
    siteItems: PRE_EVENT_SITE_ITEMS,
    resourceItems: PRE_EVENT_RESOURCE_ITEMS,
  });
  await ensureTemplate(database, {
    code: "post_event_v1",
    name: "Post-event condition and load-out checklist",
    phase: "post_event",
    siteItems: POST_EVENT_SITE_ITEMS,
    resourceItems: POST_EVENT_RESOURCE_ITEMS,
  });
}
