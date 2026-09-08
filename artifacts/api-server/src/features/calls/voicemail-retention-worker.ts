import { and, eq, lte } from "drizzle-orm";
import type { db as Database } from "@/db/client";
import { inboundVoicemails } from "@/db/schema";
import type { InboundVoiceProvider } from "./inbound-voice-provider";

/** Deletes only provider audio; inbound metadata remains available for audit/history. */
export class VoicemailRetentionWorker {
  constructor(private readonly database: typeof Database, private readonly provider: () => InboundVoiceProvider, private readonly clock = () => new Date()) {}
  async run(batchSize = 25): Promise<number> {
    const now = this.clock();
    // The state update is the claim: concurrent workers cannot select a pending
    // deletion again. A later run retries records left pending by a failure.
    const due = await this.database.select().from(inboundVoicemails).where(and(
      lte(inboundVoicemails.retentionDeadline, now),
      eq(inboundVoicemails.status, "available"),
    )).limit(batchSize);
    let deleted = 0;
    for (const voicemail of due) {
      const [claimed] = await this.database.update(inboundVoicemails).set({
        status: "deletion_pending", deletionAttemptedAt: now,
        deletionAttempts: voicemail.deletionAttempts + 1, updatedAt: now,
      }).where(and(eq(inboundVoicemails.id, voicemail.id), eq(inboundVoicemails.status, "available"))).returning();
      if (!claimed || !claimed.recordingSid) continue;
      try {
        await this.provider().deleteRecording(claimed.recordingSid);
        await this.database.update(inboundVoicemails).set({ status: "audio_deleted", recordingSid: null, deletionError: null, updatedAt: this.clock() }).where(eq(inboundVoicemails.id, claimed.id));
        deleted++;
      } catch {
        await this.database.update(inboundVoicemails).set({ status: "failed", deletionError: "provider_delete_failed", updatedAt: this.clock() }).where(eq(inboundVoicemails.id, claimed.id));
      }
    }
    return deleted;
  }
}