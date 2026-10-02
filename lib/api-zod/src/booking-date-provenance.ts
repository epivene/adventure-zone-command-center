import { z } from "zod";
const endpoints = z.object({start:z.string().nullable(),end:z.string().nullable()});
const window = z.object({start:z.string(),end:z.string()}).nullable();
export const bookingDateProvenanceSchema = z.object({
 rawPublic:endpoints,rawReservation:endpoints,publicWindow:window,reservationWindow:window,
 publicEndExclusive:z.boolean(),reservationEndExclusive:z.boolean(),
 evidenceState:z.enum(["verified","needs_review"]),reviewReasons:z.array(z.string()),
 endpointEvidence:z.array(z.object({
  field:z.enum(["public_start","public_end","reservation_start","reservation_end"]),
  kind:z.enum(["verified_event","verified_reservation","sales_milestone","unknown_import","unresolved_conflict"]),
  value:z.string().nullable(),semantics:z.enum(["instant","inclusive_date","exclusive_date"]),revision:z.number().int().positive(),
  sourceRef:z.object({type:z.string(),id:z.string(),revision:z.string()}),
 })),
});
export type BookingDateProvenance = z.infer<typeof bookingDateProvenanceSchema>;
