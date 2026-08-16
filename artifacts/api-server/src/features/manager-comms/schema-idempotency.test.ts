import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { CommunicationRepository } from "./communication-repository";
import { CommunicationParticipantRepository } from "./communication-participant-repository";
import { NotificationRepository } from "./notification-repository";
import { MeetupRequestRepository } from "./meetup-request-repository";
import { AcknowledgmentRepository } from "./acknowledgment-repository";
import { AttachmentFilingRepository } from "./attachment-filing-service";

afterAll(async () => { await pool.end(); });

describe("manager communications schema initialization", () => {
  it("is safe to run every schema initializer twice", async () => {
    const communication = new CommunicationRepository(db);
    const participants = new CommunicationParticipantRepository(db);
    const notifications = new NotificationRepository(db);
    const meetups = new MeetupRequestRepository(db);
    const acknowledgments = new AcknowledgmentRepository(db);
    const filings = new AttachmentFilingRepository(db);

    for (let pass = 0; pass < 2; pass += 1) {
      await communication.ensureSchema();
      await participants.ensureSupportSchema();
      await notifications.ensureSchema();
      await meetups.ensureSchema();
      await acknowledgments.ensureSchema();
      await filings.ensureSchema();
    }

    expect(true).toBe(true);
  });
});
