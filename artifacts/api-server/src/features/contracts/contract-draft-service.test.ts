import { describe, expect, it } from "vitest";

import type { ContractAutofillSource } from "./contract-autofill";
import {
  ContractDraftService,
  ContractDraftServiceError,
  type ContractDraftRecord,
  type ContractDraftRepository,
  type ContractVersionRecord,
} from "./contract-draft-service";
import { guaranteedFeeSnapshot } from "./fixtures/guaranteed-fee.snapshot";
import { renderContract } from "./contract-renderer";
import { contractTemplateV1 } from "./contract-template-v1";

const source: ContractAutofillSource = {
  booking: {
    id: guaranteedFeeSnapshot.bookingId,
    organizationId: guaranteedFeeSnapshot.organizationId,
    name: guaranteedFeeSnapshot.eventName,
    venueName: guaranteedFeeSnapshot.venueName,
    address1: guaranteedFeeSnapshot.venueAddress.address1,
    city: guaranteedFeeSnapshot.venueAddress.city,
    region: guaranteedFeeSnapshot.venueAddress.region,
    postalCode: guaranteedFeeSnapshot.venueAddress.postalCode,
    startsAt: new Date("2026-09-10T18:00:00.000Z"),
    endsAt: new Date("2026-09-12T22:00:00.000Z"),
    physicalAttractionTotal: 10,
  },
  organization: { id: guaranteedFeeSnapshot.organizationId, name: guaranteedFeeSnapshot.organizationName },
  bookingPrimaryContact: { firstName: "Pat", lastName: "Organizer", jobTitle: "Authorized Event Representative", email: "pat@example.com", phone: "307-555-0100" },
  organizationPrimaryContact: null,
  packages: guaranteedFeeSnapshot.packages,
  travelLeg: { name: "Colorado" },
  settings: {
    internalSignerName: "Dave Gordon", internalSignerEmail: "dave@example.com", internalSignerOrder: 2,
    insuranceRecipientName: "Sara Toone", insuranceRecipientEmail: "sara@protectiveins.net",
  },
};

class MemoryDraftRepository implements ContractDraftRepository {
  drafts = new Map<string, ContractDraftRecord>();
  versions = new Map<string, ContractVersionRecord>();
  nextDraft = 1;
  nextVersion = 1;

  async findOpenDraftByBooking(bookingId: string) {
    return [...this.drafts.values()].find((draft) => draft.bookingId === bookingId && !draft.finalizedAt) ?? null;
  }
  async createDraft(input: Parameters<ContractDraftRepository["createDraft"]>[0]) {
    const record: ContractDraftRecord = {
      id: `draft-${this.nextDraft++}`, bookingId: input.bookingId, organizationId: input.organizationId,
      templateId: input.templateId, templateVersion: input.templateVersion, arrangement: null,
      storedValues: input.storedValues, validationState: input.validationState, revision: 1,
      predecessorVersionId: input.predecessorVersionId, finalizedAt: null,
    };
    this.drafts.set(record.id, record);
    return record;
  }
  async getDraft(draftId: string) { return this.drafts.get(draftId) ?? null; }
  async saveDraft(input: Parameters<ContractDraftRepository["saveDraft"]>[0]) {
    const current = this.drafts.get(input.draftId);
    if (!current) return { kind: "not_found" as const };
    if (current.revision !== input.expectedRevision) return { kind: "stale" as const, current };
    const saved = { ...current, storedValues: input.storedValues, validationState: input.validationState, arrangement: input.arrangement, revision: current.revision + 1 };
    this.drafts.set(saved.id, saved);
    return { kind: "saved" as const, draft: saved };
  }
  async finalizeDraft(input: Parameters<ContractDraftRepository["finalizeDraft"]>[0]) {
    const existing = [...this.versions.values()].find((version) => version.draftId === input.draftId);
    if (existing) return { version: existing, reused: true };
    const draft = this.drafts.get(input.draftId)!;
    const version: ContractVersionRecord = {
      id: `version-${this.nextVersion}`, bookingId: draft.bookingId, organizationId: draft.organizationId,
      templateId: draft.templateId, draftId: draft.id, versionNumber: this.nextVersion++, status: "draft",
      snapshot: input.snapshot, renderedLegalText: input.renderedLegalText,
      signerSnapshot: input.signerSnapshot, predecessorVersionId: draft.predecessorVersionId,
      supersedingVersionId: null,
    };
    draft.finalizedAt = input.finalizedAt;
    this.versions.set(version.id, version);
    return { version, reused: false };
  }
  async getVersion(versionId: string) { return this.versions.get(versionId) ?? null; }
  async markReadyForAdobe(versionId: string) {
    const current = this.versions.get(versionId)!;
    const ready = { ...current, status: "ready_for_adobe" as const };
    this.versions.set(versionId, ready);
    return ready;
  }
}

function service(repository = new MemoryDraftRepository(), loadedSource = source) {
  const generatedFiles: Array<{ contractVersionId: string; bytes: Uint8Array; actorId: string }> = [];
  return {
    repository,
    generatedFiles,
    service: new ContractDraftService({
      repository,
      sources: { load: async (bookingId) => bookingId === loadedSource.booking.id ? loadedSource : null },
      templates: { active: async () => ({ ...contractTemplateV1, state: "active", id: "template-1" }) },
      render: renderContract,
      generatePdf: async () => ({ bytes: new TextEncoder().encode("%PDF-1.7\ncontract") }),
      files: { storeGenerated: async (input) => { generatedFiles.push(input); } },
      now: () => new Date("2026-09-08T18:00:00.000Z"),
    }),
  };
}

describe("ContractDraftService", () => {
  it("creates an incomplete draft when the booking has no package selection", async () => {
    const setup = service(new MemoryDraftRepository(), { ...source, packages: [] });

    const result = await setup.service.start({ bookingId: source.booking.id, actorId: "owner" });

    expect(result.draft.storedValues.contract.packages).toEqual([]);
    expect(result.draft.validationState.ready).toBe(false);
  });

  it("creates one resumable draft with autofill and setting snapshots", async () => {
    const setup = service();
    const first = await setup.service.start({ bookingId: source.booking.id, actorId: "owner" });
    const second = await setup.service.start({ bookingId: source.booking.id, actorId: "owner" });
    expect(first.reused).toBe(false);
    expect(second).toEqual({ draft: first.draft, reused: true });
    expect(first.draft.storedValues.insuranceRecipient).toEqual({ name: "Sara Toone", email: "sara@protectiveins.net" });
    expect(first.draft.storedValues.contract.internalSigner?.name).toBe("Dave Gordon");
  });

  it("rejects an unknown or unlinked booking", async () => {
    const setup = service();
    await expect(setup.service.start({ bookingId: "missing", actorId: "owner" }))
      .rejects.toMatchObject({ code: "CONTRACT_BOOKING_NOT_FOUND" });
    const unlinked = new ContractDraftService({
      repository: setup.repository,
      sources: { load: async () => ({ ...source, organization: null }) },
      templates: { active: async () => ({ ...contractTemplateV1, state: "active", id: "template-1" }) },
      render: renderContract,
      generatePdf: async () => ({ bytes: new TextEncoder().encode("%PDF-1.7\ncontract") }),
      files: { storeGenerated: async () => undefined },
    });
    await expect(unlinked.start({ bookingId: source.booking.id, actorId: "owner" }))
      .rejects.toMatchObject({ code: "CONTRACT_ORGANIZATION_REQUIRED" });
  });

  it("autosaves only the expected revision and keeps validation feedback", async () => {
    const setup = service();
    const started = await setup.service.start({ bookingId: source.booking.id, actorId: "owner" });
    const saved = await setup.service.save({ draftId: started.draft.id, expectedRevision: 1, values: guaranteedFeeSnapshot, actorId: "owner" });
    expect(saved.revision).toBe(2);
    expect(saved.validationState.ready).toBe(true);
    await expect(setup.service.save({ draftId: started.draft.id, expectedRevision: 1, values: guaranteedFeeSnapshot, actorId: "owner" }))
      .rejects.toMatchObject({ code: "CONTRACT_DRAFT_STALE" });
  });

  it("blocks incomplete finalization without discarding the draft", async () => {
    const setup = service();
    const started = await setup.service.start({ bookingId: source.booking.id, actorId: "owner" });
    await expect(setup.service.finalize({ draftId: started.draft.id, actorId: "owner" }))
      .rejects.toMatchObject({ code: "CONTRACT_NOT_READY" });
    expect(await setup.repository.getDraft(started.draft.id)).toBeDefined();
  });

  it("freezes a complete draft once and returns the same version on retry", async () => {
    const setup = service();
    const started = await setup.service.start({ bookingId: source.booking.id, actorId: "owner" });
    await setup.service.save({ draftId: started.draft.id, expectedRevision: 1, values: guaranteedFeeSnapshot, actorId: "owner" });
    const first = await setup.service.finalize({ draftId: started.draft.id, actorId: "owner" });
    const second = await setup.service.finalize({ draftId: started.draft.id, actorId: "owner" });
    expect(first.reused).toBe(false);
    expect(second).toEqual({ version: first.version, reused: true });
    expect(first.version.status).toBe("ready_for_adobe");
    expect(setup.generatedFiles).toHaveLength(1);
    expect(first.version.snapshot.values).toEqual(guaranteedFeeSnapshot);
    expect(first.version.renderedLegalText).toContain("$5,000.00 guaranteed event fee");
  });

  it("creates a replacement draft from an immutable version", async () => {
    const setup = service();
    const started = await setup.service.start({ bookingId: source.booking.id, actorId: "owner" });
    await setup.service.save({ draftId: started.draft.id, expectedRevision: 1, values: guaranteedFeeSnapshot, actorId: "owner" });
    const finalized = await setup.service.finalize({ draftId: started.draft.id, actorId: "owner" });
    const replacement = await setup.service.createReplacement({ contractVersionId: finalized.version.id, actorId: "owner" });
    expect(replacement.predecessorVersionId).toBe(finalized.version.id);
    expect(replacement.storedValues.contract).toEqual(guaranteedFeeSnapshot);
    expect(finalized.version.snapshot.values).toEqual(guaranteedFeeSnapshot);
  });

  it("uses typed service errors", () => {
    expect(new ContractDraftServiceError("TEST", "message")).toMatchObject({ code: "TEST", message: "message" });
  });
});
