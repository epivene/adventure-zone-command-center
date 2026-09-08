import { describe, expect, it } from "vitest";

import {
  ContractLifecycleService,
  ContractLifecycleServiceError,
  type ContractLifecycleRepository,
  type ContractLifecycleState,
} from "./contract-lifecycle-service";

class MemoryLifecycleRepository implements ContractLifecycleRepository {
  state: ContractLifecycleState = { contractVersionId: "version-1", bookingId: "booking-1", contractStatus: "ready_for_adobe", bookingStatus: "quote_sent" };
  keys = new Set<string>();
  statusEvents = 0;
  activities = 0;
  audits = 0;
  bookingUpdates: string[] = [];

  async get(versionId: string) { return versionId === this.state.contractVersionId ? { ...this.state } : null; }
  async commit(input: Parameters<ContractLifecycleRepository["commit"]>[0]) {
    if (this.keys.has(input.idempotencyKey)) return { state: { ...this.state }, reused: true };
    this.keys.add(input.idempotencyKey);
    this.state.contractStatus = input.toStatus;
    this.statusEvents += 1;
    this.activities += 1;
    this.audits += 1;
    if (input.bookingStatus && input.bookingStatus !== this.state.bookingStatus) {
      this.state.bookingStatus = input.bookingStatus;
      this.bookingUpdates.push(input.bookingStatus);
    }
    return { state: { ...this.state }, reused: false };
  }
  async confirmSignedFile(input: Parameters<ContractLifecycleRepository["confirmSignedFile"]>[0]) {
    if (input.fileId === "foreign") throw new ContractLifecycleServiceError("CONTRACT_SIGNED_FILE_NOT_FOUND", "Signed contract file not found.");
    if (this.keys.has(input.idempotencyKey)) return { state: { ...this.state }, reused: true };
    if (!["sent_for_signature", "partially_signed"].includes(this.state.contractStatus)) throw new ContractLifecycleServiceError("CONTRACT_COMPLETION_INVALID", "This contract cannot be completed from its current status.");
    this.keys.add(input.idempotencyKey);
    this.state.contractStatus = "completed";
    if (!this.state.bookingStatus || !["contract_received", "confirmed", "completed", "renewal_due", "declined", "cancelled"].includes(this.state.bookingStatus)) {
      this.state.bookingStatus = "contract_received";
      this.bookingUpdates.push("contract_received");
    }
    this.statusEvents += 1; this.activities += 1; this.audits += 1;
    return { state: { ...this.state }, reused: false };
  }
}

describe("ContractLifecycleService", () => {
  it("allows only explicit signing transitions", async () => {
    const repository = new MemoryLifecycleRepository();
    const service = new ContractLifecycleService(repository);
    await expect(service.transition({ contractVersionId: "version-1", toStatus: "completed", actorId: "owner", idempotencyKey: "bad-jump" }))
      .rejects.toMatchObject({ code: "CONTRACT_TRANSITION_INVALID" });
    await service.confirmAdobeSent({ contractVersionId: "version-1", actorId: "owner" });
    expect(repository.state.contractStatus).toBe("sent_for_signature");
    await service.transition({ contractVersionId: "version-1", toStatus: "partially_signed", actorId: "owner", idempotencyKey: "partial" });
    await service.transition({ contractVersionId: "version-1", toStatus: "completed", actorId: "owner", idempotencyKey: "complete" });
    expect(repository.state.contractStatus).toBe("completed");
  });

  it("confirms Adobe once and records one status event, activity, and audit", async () => {
    const repository = new MemoryLifecycleRepository();
    const service = new ContractLifecycleService(repository);
    const first = await service.confirmAdobeSent({ contractVersionId: "version-1", actorId: "owner" });
    const retry = await service.confirmAdobeSent({ contractVersionId: "version-1", actorId: "owner" });
    expect(first.reused).toBe(false);
    expect(retry.reused).toBe(true);
    expect(repository).toMatchObject({ statusEvents: 1, activities: 1, audits: 1, bookingUpdates: ["pending_contract"] });
  });

  it("never regresses an advanced or terminal booking", async () => {
    const repository = new MemoryLifecycleRepository();
    const service = new ContractLifecycleService(repository);
    repository.state.bookingStatus = "confirmed";
    await service.confirmAdobeSent({ contractVersionId: "version-1", actorId: "owner" });
    expect(repository.bookingUpdates).toEqual([]);
    repository.state = { contractVersionId: "version-2", bookingId: "booking-2", contractStatus: "ready_for_adobe", bookingStatus: "declined" };
    await service.confirmAdobeSent({ contractVersionId: "version-2", actorId: "owner" });
    expect(repository.bookingUpdates).toEqual([]);
  });

  it("permits supersession from active states and uses typed errors", async () => {
    const repository = new MemoryLifecycleRepository();
    const service = new ContractLifecycleService(repository);
    await service.transition({ contractVersionId: "version-1", toStatus: "superseded", actorId: "owner", idempotencyKey: "replace" });
    expect(repository.state.contractStatus).toBe("superseded");
    expect(new ContractLifecycleServiceError("TEST", "message")).toMatchObject({ code: "TEST", message: "message" });
  });

  it("confirms one owned signed revision, completes once, and does not regress the booking", async () => {
    const repository = new MemoryLifecycleRepository();
    repository.state.contractStatus = "sent_for_signature";
    const service = new ContractLifecycleService(repository);
    const first = await service.confirmSignedFile({ contractVersionId: "version-1", fileId: "signed-1", actorId: "owner" });
    const retry = await service.confirmSignedFile({ contractVersionId: "version-1", fileId: "signed-1", actorId: "owner" });
    expect(first.reused).toBe(false);
    expect(retry.reused).toBe(true);
    expect(repository).toMatchObject({ statusEvents: 1, activities: 1, audits: 1, bookingUpdates: ["contract_received"] });
    await expect(service.confirmSignedFile({ contractVersionId: "version-1", fileId: "foreign", actorId: "owner" })).rejects.toMatchObject({ code: "CONTRACT_SIGNED_FILE_NOT_FOUND" });
  });
});
