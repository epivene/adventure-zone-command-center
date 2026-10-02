import { z } from "zod";
export const repairProposalSchema=z.object({bookingId:z.string().uuid(),reason:z.string().trim().min(8).max(2000),endpoints:z.array(z.object({
 field:z.enum(["public_start","public_end","reservation_start","reservation_end"]),kind:z.enum(["verified_event","verified_reservation","sales_milestone","unknown_import","unresolved_conflict"]),
 value:z.string().max(80).nullable(),semantics:z.enum(["instant","inclusive_date","exclusive_date"]),
 sourceRef:z.object({type:z.enum(["saved_note","business_document","google_calendar_review","saved_event_fact","act_source_version","leg_plan_mutation_receipt"]),id:z.string().uuid()}).strict()
}).strict()).min(1).max(4),reconcileConfirmedWindow:z.boolean().optional(),clearFields:z.array(z.enum(["public_start","public_end","reservation_start","reservation_end"])).max(4)
}).strict().superRefine((p,ctx)=>{if(new Set(p.endpoints.map(e=>e.field)).size!==p.endpoints.length)ctx.addIssue({code:"custom",message:"Select each endpoint once"});});
export type RepairProposalInput=z.infer<typeof repairProposalSchema>;
export const repairApplySchema=z.object({previewId:z.string().uuid(),fingerprint:z.string().min(1).max(128),requestKey:z.string().min(1).max(120)}).strict();
export const repairQueueSchema=z.object({season:z.coerce.number().int().min(1).max(9998).optional(),reason:z.enum(["INCOMPLETE_PUBLIC_WINDOW","INCOMPLETE_RESERVATION_WINDOW","REVERSED_PUBLIC_WINDOW","REVERSED_RESERVATION_WINDOW"]).optional(),bookingId:z.string().uuid().optional(),after:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(50).default(25)}).strict();
