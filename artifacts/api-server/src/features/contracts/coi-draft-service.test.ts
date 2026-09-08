import { describe, expect, it } from "vitest";

import { guaranteedFeeSnapshot } from "./fixtures/guaranteed-fee.snapshot";
import {
  CoiDraftService,
  buildCoiDraft,
  evaluateCoiReadiness,
  type CoiDraftPersistence,
  type CoiDraftRecord,
} from "./coi-draft-service";

const complete = {
  eventName: "Stone Age Stampede – Dinosaur CO 2026",
  eventStartDate: "2026-09-11",
  eventEndDate: "2026-09-12",
  certificateHolderName: "Town of Dinosaur",
  certificateHolderAddress: "317 Stegosaurus Fwy\nPO Box 225\nDinosaur, CO 81610",
  additionalInsuredWording: "The Town of Dinosaur, Dinosaur Stone Age Stampede Committee, and their volunteers as additional insured.",
  recipientName: "Sara Toone",
  recipientEmail: "sara@protectiveins.net",
};

class MemoryPersistence implements CoiDraftPersistence {
  record: CoiDraftRecord | null = null;
  context = {
    contractVersionId: "version-1", status: "completed" as const,
    values: { ...guaranteedFeeSnapshot, eventName: complete.eventName, eventStartDate: complete.eventStartDate, eventEndDate: complete.eventEndDate, coi: {
      certificateHolderName: complete.certificateHolderName, certificateHolderAddress: complete.certificateHolderAddress,
      additionalInsuredWording: complete.additionalInsuredWording,
    } },
    recipient: { name: complete.recipientName, email: complete.recipientEmail },
  };
  async loadContext() { return this.context; }
  async get() { return this.record; }
  async detailsNeeded(input: Parameters<CoiDraftPersistence["detailsNeeded"]>[0]) { return this.write(input, "details_needed"); }
  async reserve(input: Parameters<CoiDraftPersistence["reserve"]>[0]) {
    if (this.record?.state === "created") return { record: this.record, shouldCall: false };
    if (this.record?.state === "prepared" || this.record?.state === "manual_review") return { record: { ...this.record, state: "manual_review" as const }, shouldCall: false };
    return { record: this.write(input, "prepared"), shouldCall: true };
  }
  async outcome(input: Parameters<CoiDraftPersistence["outcome"]>[0]) {
    this.record = { ...this.record!, ...input, updatedAt: input.now };
    return this.record;
  }
  private write(input: { contractVersionId: string; recipientName: string; recipientEmail: string; subject: string; body: string; idempotencyKey: string; now: Date }, state: CoiDraftRecord["state"]) {
    this.record = {
      id: "coi-1", ...input, state, googleConnectionId: null, gmailDraftId: null, gmailMessageId: null,
      lastErrorCode: null, attemptCount: (this.record?.attemptCount ?? 0) + (state === "prepared" ? 1 : 0), completedAt: null, updatedAt: input.now,
    };
    return this.record;
  }
}

describe("COI draft copy", () => {
  it("uses Sara, the recent Adventure Zone structure, exact wording, dates, holder, and signature", () => {
    const draft = buildCoiDraft(complete);
    expect(draft).toMatchObject({ to: "sara@protectiveins.net", subject: "COI Request for Stone Age Stampede – Dinosaur CO 2026" });
    expect(draft.body).toContain("This is Desiree from The Adventure Zone. I work with David Gordon.");
    expect(draft.body).toContain(complete.additionalInsuredWording);
    expect(draft.body).toContain("September 11–12, 2026");
    expect(draft.body).toContain(complete.certificateHolderAddress);
    expect(draft.body).toContain("TheAdventureZone12@gmail.com");
  });

  it("identifies every missing COI field", () => {
    expect(evaluateCoiReadiness({ ...complete, additionalInsuredWording: "" }).missing).toContain("additionalInsuredWording");
  });
});

describe("CoiDraftService", () => {
  it("does not call Gmail when details are missing", async () => {
    const persistence = new MemoryPersistence();
    persistence.context.values.coi.additionalInsuredWording = "";
    const provider = { createDraft: async () => { throw new Error("must not call"); } };
    const result = await new CoiDraftService({ persistence, provider }).createOrRecover({ contractVersionId: "version-1", actorId: "owner" });
    expect(result.record.state).toBe("details_needed");
  });

  it("creates exactly one unsent Gmail draft and reuses its IDs", async () => {
    const persistence = new MemoryPersistence();
    let calls = 0;
    const provider = { createDraft: async () => { calls += 1; return { connectionId: "google-1", draftId: "draft-1", messageId: "message-1" }; } };
    const service = new CoiDraftService({ persistence, provider, now: () => new Date("2026-09-08T20:00:00Z") });
    const first = await service.createOrRecover({ contractVersionId: "version-1", actorId: "owner" });
    const retry = await service.createOrRecover({ contractVersionId: "version-1", actorId: "owner" });
    expect(first.record).toMatchObject({ state: "created", gmailDraftId: "draft-1", gmailMessageId: "message-1" });
    expect(retry.reused).toBe(true);
    expect(calls).toBe(1);
    expect("send" in provider).toBe(false);
  });

  it("records known failures as retryable and uncertain outcomes as manual review without blind retry", async () => {
    const retryable = new MemoryPersistence();
    const known = Object.assign(new Error("rejected"), { code: "GOOGLE_WORKSPACE_RATE_LIMITED" });
    const first = await new CoiDraftService({ persistence: retryable, provider: { createDraft: async () => { throw known; } } }).createOrRecover({ contractVersionId: "version-1", actorId: "owner" });
    expect(first.record.state).toBe("retryable_error");
    const uncertain = new MemoryPersistence();
    let calls = 0;
    const service = new CoiDraftService({ persistence: uncertain, provider: { createDraft: async () => { calls += 1; throw new Error("timeout after request"); } } });
    expect((await service.createOrRecover({ contractVersionId: "version-1", actorId: "owner" })).record.state).toBe("manual_review");
    expect((await service.createOrRecover({ contractVersionId: "version-1", actorId: "owner" })).record.state).toBe("manual_review");
    expect(calls).toBe(1);
  });
});
