import { and, eq, gt, isNull, lte } from "drizzle-orm";
import type { db as Database } from "@/db/client";
import { incomingCallAvailabilityLeases } from "@/db/schema";
import type { LeaseMutation, ResolvedLease } from "./incoming-availability-types";
export interface IncomingAvailabilityRepository {
 acquire(input: LeaseMutation, now: Date, takeover: boolean): Promise<boolean>;
 renew(input: { ownerId:string; leaseId:string; leaseTokenHash:string; expiresAt:Date; now:Date }): Promise<boolean>;
 release(input: { ownerId:string; leaseId:string; leaseTokenHash:string }): Promise<boolean>;
 verify(input: { ownerId:string; leaseId:string; leaseTokenHash:string }, now: Date): Promise<ResolvedLease|null>;
 resolveOwner(ownerId:string, now:Date): Promise<ResolvedLease|null>;
 resolveIdentity(identity:string, now:Date): Promise<ResolvedLease|null>;
}
type DB = typeof Database;
const resolved = (row: typeof incomingCallAvailabilityLeases.$inferSelect): ResolvedLease => ({ leaseId:row.id, ownerId:row.ownerId, clientIdentity:row.clientIdentity, expiresAt:row.expiresAt, activeInboundSessionId:row.activeInboundSessionId });
export class DrizzleIncomingAvailabilityRepository implements IncomingAvailabilityRepository {
 constructor(private database: DB) {}
 async acquire(input: LeaseMutation, now: Date, takeover: boolean): Promise<boolean> {
  const changed = await this.database.update(incomingCallAvailabilityLeases).set({ id:input.leaseId, clientIdentity:input.clientIdentity, leaseTokenHash:input.leaseTokenHash, browserSessionId:input.browserSessionId, expiresAt:input.expiresAt, heartbeatAt:now, updatedAt:now }).where(and(eq(incomingCallAvailabilityLeases.ownerId,input.ownerId), isNull(incomingCallAvailabilityLeases.activeInboundSessionId), takeover ? undefined : lte(incomingCallAvailabilityLeases.expiresAt, now))).returning();
  if (changed[0]) return true;
  try { const made = await this.database.insert(incomingCallAvailabilityLeases).values({ id:input.leaseId, ownerId:input.ownerId, clientIdentity:input.clientIdentity, leaseTokenHash:input.leaseTokenHash, browserSessionId:input.browserSessionId, expiresAt:input.expiresAt, heartbeatAt:now, createdAt:now, updatedAt:now }).onConflictDoNothing().returning(); return Boolean(made[0]); } catch { return false; }
 }
 async renew(input: { ownerId:string;leaseId:string;leaseTokenHash:string;expiresAt:Date;now:Date }): Promise<boolean> { return Boolean((await this.database.update(incomingCallAvailabilityLeases).set({expiresAt:input.expiresAt,heartbeatAt:input.now,updatedAt:input.now}).where(and(eq(incomingCallAvailabilityLeases.ownerId,input.ownerId),eq(incomingCallAvailabilityLeases.id,input.leaseId),eq(incomingCallAvailabilityLeases.leaseTokenHash,input.leaseTokenHash),gt(incomingCallAvailabilityLeases.expiresAt,input.now))).returning())[0]); }
 async release(input: {ownerId:string;leaseId:string;leaseTokenHash:string}): Promise<boolean> { return Boolean((await this.database.delete(incomingCallAvailabilityLeases).where(and(eq(incomingCallAvailabilityLeases.ownerId,input.ownerId),eq(incomingCallAvailabilityLeases.id,input.leaseId),eq(incomingCallAvailabilityLeases.leaseTokenHash,input.leaseTokenHash),isNull(incomingCallAvailabilityLeases.activeInboundSessionId))).returning())[0]); }
 async verify(input:{ownerId:string;leaseId:string;leaseTokenHash:string},now:Date) { const [row]=await this.database.select().from(incomingCallAvailabilityLeases).where(and(eq(incomingCallAvailabilityLeases.ownerId,input.ownerId),eq(incomingCallAvailabilityLeases.id,input.leaseId),eq(incomingCallAvailabilityLeases.leaseTokenHash,input.leaseTokenHash),gt(incomingCallAvailabilityLeases.expiresAt,now))).limit(1); return row?resolved(row):null; }
 async resolveOwner(ownerId:string,now:Date) { const [row]=await this.database.select().from(incomingCallAvailabilityLeases).where(and(eq(incomingCallAvailabilityLeases.ownerId,ownerId),gt(incomingCallAvailabilityLeases.expiresAt,now))).limit(1); return row?resolved(row):null; }
 async resolveIdentity(clientIdentity:string,now:Date) { const [row]=await this.database.select().from(incomingCallAvailabilityLeases).where(and(eq(incomingCallAvailabilityLeases.clientIdentity,clientIdentity),gt(incomingCallAvailabilityLeases.expiresAt,now))).limit(1); return row?resolved(row):null; }
}