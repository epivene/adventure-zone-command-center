import { eq } from "drizzle-orm";
import type { db as Database } from "@/db/client";
import { contactPhones } from "@/db/schema";
import { normalizeNanpPhone } from "./nanp-phone";
export type InboundCallerMatch = { callerNumber: string | null; organizationId: string | null; contactId: string | null; phoneId: string | null };
export interface InboundCallerMatcher { match(from: string | undefined): Promise<InboundCallerMatch>; }
export class DrizzleInboundCallerMatcher implements InboundCallerMatcher {
 constructor(private database: typeof Database) {}
 async match(from: string | undefined): Promise<InboundCallerMatch> {
  const normalized = from ? normalizeNanpPhone(from) : null;
  if (!normalized) return { callerNumber:null,organizationId:null,contactId:null,phoneId:null };
  const matches=await this.database.select({phoneId:contactPhones.id,contactId:contactPhones.contactId}).from(contactPhones).where(eq(contactPhones.normalizedNumber,normalized)).limit(2);
  if (matches.length !== 1) return {callerNumber:normalized,organizationId:null,contactId:null,phoneId:null};
  return {callerNumber:normalized,organizationId:null,contactId:matches[0]!.contactId,phoneId:matches[0]!.phoneId};
 }
}