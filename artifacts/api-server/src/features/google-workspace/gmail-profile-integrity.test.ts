import { describe, expect, it } from "vitest";

import {
  TWIN_FALLS_MISSED_CALL_EMAIL,
  repairGmailProfileIntegrity,
  type GmailProfileIntegrityAudit,
  type GmailProfileIntegrityRepository,
} from "./gmail-profile-integrity";

class FakeRepository implements GmailProfileIntegrityRepository {
  readonly calls: string[] = [];

  constructor(
    private readonly auditResult: GmailProfileIntegrityAudit = {
      sentEmailActivities: 17,
      profileEligibleSentEmails: 17,
      activeProfileLinkedSentEmails: 17,
      eligibleUnlinkedSentEmails: 0,
      retiredProfileReferences: 0,
      unresolved: [],
    },
  ) {}

  async ensureSchema(): Promise<void> {
    this.calls.push("schema");
  }

  async repairCanonicalReferences(): Promise<number> {
    this.calls.push("canonical");
    return 3;
  }

  async repairDeterministicProfileLinks(): Promise<number> {
    this.calls.push("deterministic");
    return 5;
  }

  async ensureTwinFallsMissedCallEmail(): Promise<"created" | "linked" | "existing"> {
    this.calls.push("twin-falls");
    return "created";
  }

  async audit(): Promise<GmailProfileIntegrityAudit> {
    this.calls.push("audit");
    return this.auditResult;
  }
}

describe("repairGmailProfileIntegrity", () => {
  it("repairs canonical references, deterministic links, and the exact Twin Falls sent email before auditing", async () => {
    const repository = new FakeRepository();

    const result = await repairGmailProfileIntegrity(repository);

    expect(repository.calls).toEqual([
      "schema",
      "canonical",
      "deterministic",
      "twin-falls",
      "canonical",
      "deterministic",
      "audit",
    ]);
    expect(result).toEqual({
      canonicalReferencesRepaired: 6,
      deterministicLinksRepaired: 10,
      twinFallsMessage: "created",
      audit: {
        sentEmailActivities: 17,
        profileEligibleSentEmails: 17,
        activeProfileLinkedSentEmails: 17,
        eligibleUnlinkedSentEmails: 0,
        retiredProfileReferences: 0,
        unresolved: [],
      },
    });
  });

  it("does not hide unresolved eligible sent messages", async () => {
    const repository = new FakeRepository({
      sentEmailActivities: 22,
      profileEligibleSentEmails: 20,
      activeProfileLinkedSentEmails: 18,
      eligibleUnlinkedSentEmails: 2,
      retiredProfileReferences: 1,
      unresolved: [
        {
          activityId: "00000000-0000-4000-8000-000000000011",
          subject: "County Fair follow-up",
          occurredAt: "2026-08-12T18:00:00.000Z",
          reason: "multiple_profile_matches",
        },
        {
          activityId: "00000000-0000-4000-8000-000000000012",
          subject: "Festival inquiry",
          occurredAt: "2026-08-13T18:00:00.000Z",
          reason: "retired_profile_only",
        },
      ],
    });

    const result = await repairGmailProfileIntegrity(repository);

    expect(result.audit.eligibleUnlinkedSentEmails).toBe(2);
    expect(result.audit.retiredProfileReferences).toBe(1);
    expect(result.audit.unresolved).toHaveLength(2);
  });
});

describe("TWIN_FALLS_MISSED_CALL_EMAIL", () => {
  it("pins the real Gmail message and surviving profile instead of creating another summary note", () => {
    expect(TWIN_FALLS_MISSED_CALL_EMAIL).toMatchObject({
      gmailMessageId: "1a03f76015409bfa",
      gmailThreadId: "1a03f6d13a293ebf",
      organizationId: "b447c83c-6348-4fab-b850-0db7a5576a83",
      direction: "sent",
      fromAddress: "theadventurezone12@gmail.com",
      toAddresses: ["fair@tfcfair.com"],
      subject: "Twin Falls County Fair - Sept 2-7 2026",
      occurredAt: "2026-08-26T19:04:53.000Z",
    });
    expect(TWIN_FALLS_MISSED_CALL_EMAIL.body).toContain(
      "Thank you for calling me back. I tried returning your call",
    );
    expect(TWIN_FALLS_MISSED_CALL_EMAIL.body).toContain(
      "We can work with events in a couple of different ways.",
    );
    expect(TWIN_FALLS_MISSED_CALL_EMAIL.body).toContain(
      "who the best person is for me to speak with about entertainment for the 2027 fair",
    );
  });
});
