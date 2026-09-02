import { and, asc, eq, lt } from "drizzle-orm";
import type { db as Database } from "@/db/client";
import { contactPhones, inboundCallSessions, inboundVoicemails, organizationContacts } from "@/db/schema";
import type { InboundVoiceProvider } from "./inbound-voice-provider";

export type VoicemailView = {
  id: string; status: "processing" | "available" | "handled" | "deleting" | "audio-deleted" | "failed";
  receivedAt: string; callerDisplay: string; matched: boolean; contactId: string | null; organizationId: string | null; phoneId: string | null;
  durationSeconds: number | null; canCallBack: boolean; callbackReason: string | null; canLink: boolean;
};
export class InboundVoicemailService {
  constructor(private readonly database: typeof Database, private readonly provider: () => InboundVoiceProvider, private readonly clock = () => new Date()) {}
  private view(row: any): VoicemailView {
    const status = row.status === "deletion_pending" ? "deleting" : row.status === "audio_deleted" ? "audio-deleted" : row.status;
    return { id: row.id, status, receivedAt: row.createdAt.toISOString(), callerDisplay: row.callerNumberSnapshot ? "Caller" : "Unknown caller",
      matched: Boolean(row.phoneId), contactId: row.contactId, organizationId: row.organizationId, phoneId: row.phoneId,
      durationSeconds: row.durationSeconds, canCallBack: false, callbackReason: row.phoneId ? "Stored phone must be validated before callback" : "Link a stored callable phone first", canLink: !row.phoneId };
  }
  async list(ownerId: string, cursor?: string) {
    const rows = await this.database.select({ voicemail: inboundVoicemails, callerNumberSnapshot: inboundCallSessions.callerNumberSnapshot })
      .from(inboundVoicemails).innerJoin(inboundCallSessions, eq(inboundVoicemails.inboundSessionId, inboundCallSessions.id))
      .where(and(eq(inboundCallSessions.ownerId, ownerId), cursor ? lt(inboundVoicemails.id, cursor) : undefined)).orderBy(asc(inboundVoicemails.createdAt)).limit(51);
    const items = rows.slice(0, 50).map((row) => this.view({ ...row.voicemail, callerNumberSnapshot: row.callerNumberSnapshot }));
    return { items, nextCursor: rows.length > 50 ? items.at(-1)?.id ?? null : null, newCount: items.filter(x => x.status === "available").length, handledCount: items.filter(x => x.status === "handled").length };
  }
  async get(ownerId: string, id: string) {
    const [row] = await this.database.select({ voicemail: inboundVoicemails, callerNumberSnapshot: inboundCallSessions.callerNumberSnapshot })
      .from(inboundVoicemails).innerJoin(inboundCallSessions, eq(inboundVoicemails.inboundSessionId, inboundCallSessions.id))
      .where(and(eq(inboundVoicemails.id, id), eq(inboundCallSessions.ownerId, ownerId))).limit(1);
    return row ? { row: row.voicemail, view: this.view({ ...row.voicemail, callerNumberSnapshot: row.callerNumberSnapshot }) } : null;
  }
  async markHandled(ownerId: string, id: string) {
    const found = await this.get(ownerId, id); if (!found) return false;
    await this.database.update(inboundVoicemails).set({ status: "handled", handledAt: this.clock(), handledBy: ownerId, updatedAt: this.clock() }).where(eq(inboundVoicemails.id, id)); return true;
  }
  async link(ownerId: string, id: string, input: { organizationId: string; contactId: string; phoneId: string }) {
    const found = await this.get(ownerId, id); if (!found) return false;
    const [phone, membership] = await Promise.all([
      this.database.select({ id: contactPhones.id }).from(contactPhones).where(and(eq(contactPhones.id, input.phoneId), eq(contactPhones.contactId, input.contactId))).limit(1),
      this.database.select({ id: organizationContacts.id }).from(organizationContacts).where(and(eq(organizationContacts.organizationId, input.organizationId), eq(organizationContacts.contactId, input.contactId), eq(organizationContacts.active, true))).limit(1),
    ]);
    if (phone.length !== 1 || membership.length !== 1) return false;
    // A link is only metadata: it never uses a caller snapshot as a destination.
    await this.database.update(inboundVoicemails).set({ ...input, updatedAt: this.clock() }).where(eq(inboundVoicemails.id, id)); return true;
  }
  async deleteAudio(ownerId: string, id: string) {
    const found = await this.get(ownerId, id); if (!found || !found.row.recordingSid || ["audio_deleted", "deletion_pending"].includes(found.row.status)) return false;
    await this.database.update(inboundVoicemails).set({ status: "deletion_pending", deletionAttemptedAt: this.clock(), updatedAt: this.clock() }).where(eq(inboundVoicemails.id, id));
    try { await this.provider().deleteRecording(found.row.recordingSid); await this.database.update(inboundVoicemails).set({ status: "audio_deleted", recordingSid: null, deletionError: null, updatedAt: this.clock() }).where(eq(inboundVoicemails.id, id)); return true; }
    catch { await this.database.update(inboundVoicemails).set({ deletionError: "provider_delete_failed", updatedAt: this.clock() }).where(eq(inboundVoicemails.id, id)); return false; }
  }
  async media(ownerId: string, id: string) { const found = await this.get(ownerId,id); if (!found || !found.row.recordingSid || !["available","handled"].includes(found.row.status)) return null; return this.provider().getRecordingMedia(found.row.recordingSid); }
  async record(input: { parentSid: string; recordingSid: string; duration?: number; retentionDays: number }) {
    const [session] = await this.database.select().from(inboundCallSessions).where(eq(inboundCallSessions.providerParentCallSid, input.parentSid)).limit(1);
    if (!session) return false;
    const now = this.clock();
    await this.database.insert(inboundVoicemails).values({ inboundSessionId: session.id, recordingSid: input.recordingSid, status: "available", durationSeconds: input.duration, contentType: "audio/mpeg", retentionDeadline: new Date(now.getTime() + input.retentionDays * 86_400_000), createdAt: now, updatedAt: now, deletionAttempts: 0 }).onConflictDoNothing();
    return true;
  }
}