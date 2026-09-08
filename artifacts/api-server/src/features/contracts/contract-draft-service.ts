import { buildContractAutofill, type ContractAutofillSource } from "./contract-autofill";
import { renderContract, type RenderedContract } from "./contract-renderer";
import type { ContractTemplateDefinition } from "./contract-template-v1";
import type {
  ContractArrangement,
  ContractReadiness,
  ContractSigner,
  ContractValues,
} from "./contract-types";
import { validateContractValues } from "./contract-validation";

export type StoredContractDraftValues = {
  contract: Partial<ContractValues>;
  insuranceRecipient: { name: string; email: string };
};

export type ContractSnapshot = {
  values: ContractValues;
  template: { stableKey: string; version: number };
  insuranceRecipient: { name: string; email: string };
  finalizedAt: string;
};

export type ContractDraftRecord = {
  id: string;
  bookingId: string;
  organizationId: string;
  templateId: string;
  templateVersion: number;
  arrangement: ContractArrangement | null;
  storedValues: StoredContractDraftValues;
  validationState: ContractReadiness;
  revision: number;
  predecessorVersionId: string | null;
  finalizedAt: Date | null;
};

export type ContractVersionRecord = {
  id: string;
  bookingId: string;
  organizationId: string;
  templateId: string;
  draftId: string;
  versionNumber: number;
  status: "draft" | "ready_for_adobe" | "sent_for_signature" | "partially_signed" | "completed" | "declined" | "cancelled" | "superseded";
  snapshot: ContractSnapshot;
  renderedLegalText: string;
  signerSnapshot: ContractSigner[];
  predecessorVersionId: string | null;
  supersedingVersionId: string | null;
};

export interface ContractDraftRepository {
  findOpenDraftByBooking(bookingId: string): Promise<ContractDraftRecord | null>;
  createDraft(input: {
    bookingId: string;
    organizationId: string;
    templateId: string;
    templateVersion: number;
    storedValues: StoredContractDraftValues;
    validationState: ContractReadiness;
    predecessorVersionId: string | null;
    actorId: string;
    now: Date;
  }): Promise<ContractDraftRecord>;
  getDraft(draftId: string): Promise<ContractDraftRecord | null>;
  saveDraft(input: {
    draftId: string;
    expectedRevision: number;
    arrangement: ContractArrangement;
    storedValues: StoredContractDraftValues;
    validationState: ContractReadiness;
    actorId: string;
    now: Date;
  }): Promise<{ kind: "saved"; draft: ContractDraftRecord } | { kind: "stale"; current: ContractDraftRecord } | { kind: "not_found" }>;
  finalizeDraft(input: {
    draftId: string;
    snapshot: ContractSnapshot;
    renderedLegalText: string;
    signerSnapshot: ContractSigner[];
    actorId: string;
    finalizedAt: Date;
  }): Promise<{ version: ContractVersionRecord; reused: boolean }>;
  getVersion(versionId: string): Promise<ContractVersionRecord | null>;
  markReadyForAdobe(versionId: string, actorId: string, now: Date): Promise<ContractVersionRecord>;
}

type ActiveTemplate = ContractTemplateDefinition & { id: string };

export class ContractDraftServiceError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ContractDraftServiceError";
  }
}

function incompleteReadiness(): ContractReadiness {
  return {
    ready: false,
    errors: [{ path: "contract", code: "CONTRACT_INCOMPLETE", message: "Complete the required contract details." }],
    warnings: [],
    coiMissing: ["certificateHolderName", "certificateHolderAddress", "additionalInsuredWording"],
  };
}

function isComplete(values: Partial<ContractValues>): values is ContractValues {
  return Boolean(
    values.organizationId && values.organizationName && values.bookingId && values.eventName
    && values.venueAddress && values.eventStartDate && values.eventEndDate
    && values.eventSigner && values.internalSigner && values.packages
    && values.arrangement && values.commercialTerms && values.operationalTerms && values.coi,
  );
}

function readiness(values: Partial<ContractValues>) {
  return isComplete(values) ? validateContractValues(values) : incompleteReadiness();
}

export class ContractDraftService {
  private readonly now: () => Date;
  private readonly render: (values: ContractValues) => RenderedContract;

  constructor(private readonly dependencies: {
    repository: ContractDraftRepository;
    sources: { load(bookingId: string): Promise<ContractAutofillSource | null> };
    templates: { active(): Promise<ActiveTemplate> };
    render?: (values: ContractValues) => RenderedContract;
    generatePdf: (values: ContractValues) => Promise<{ bytes: Uint8Array }>;
    files: { storeGenerated(input: { contractVersionId: string; bytes: Uint8Array; actorId: string }): Promise<unknown> };
    now?: () => Date;
  }) {
    this.now = dependencies.now ?? (() => new Date());
    this.render = dependencies.render ?? renderContract;
  }

  async start(input: { bookingId: string; actorId: string }) {
    const existing = await this.dependencies.repository.findOpenDraftByBooking(input.bookingId);
    if (existing) return { draft: existing, reused: true };
    const source = await this.dependencies.sources.load(input.bookingId);
    if (!source) throw new ContractDraftServiceError("CONTRACT_BOOKING_NOT_FOUND", "Booking not found.");
    if (!source.organization || !source.booking.organizationId) {
      throw new ContractDraftServiceError("CONTRACT_ORGANIZATION_REQUIRED", "Link the booking to an event profile before creating a contract.");
    }
    const template = await this.dependencies.templates.active();
    const autofill = buildContractAutofill(source);
    const storedValues = { contract: autofill.values, insuranceRecipient: autofill.insuranceRecipient };
    const draft = await this.dependencies.repository.createDraft({
      bookingId: input.bookingId,
      organizationId: source.organization.id,
      templateId: template.id,
      templateVersion: template.version,
      storedValues,
      validationState: readiness(autofill.values),
      predecessorVersionId: null,
      actorId: input.actorId,
      now: this.now(),
    });
    return { draft, reused: false };
  }

  async save(input: { draftId: string; expectedRevision: number; values: ContractValues; actorId: string }) {
    const current = await this.dependencies.repository.getDraft(input.draftId);
    if (!current) throw new ContractDraftServiceError("CONTRACT_DRAFT_NOT_FOUND", "Contract draft not found.");
    if (current.finalizedAt) throw new ContractDraftServiceError("CONTRACT_DRAFT_FINALIZED", "Create a replacement instead of editing a finalized contract.");
    const validationState = validateContractValues(input.values);
    const result = await this.dependencies.repository.saveDraft({
      draftId: input.draftId,
      expectedRevision: input.expectedRevision,
      arrangement: input.values.arrangement,
      storedValues: { ...current.storedValues, contract: input.values },
      validationState,
      actorId: input.actorId,
      now: this.now(),
    });
    if (result.kind === "not_found") throw new ContractDraftServiceError("CONTRACT_DRAFT_NOT_FOUND", "Contract draft not found.");
    if (result.kind === "stale") throw new ContractDraftServiceError("CONTRACT_DRAFT_STALE", "This draft changed in another session. Refresh before saving.", { currentRevision: result.current.revision });
    return result.draft;
  }

  async finalize(input: { draftId: string; actorId: string }) {
    const draft = await this.dependencies.repository.getDraft(input.draftId);
    if (!draft) throw new ContractDraftServiceError("CONTRACT_DRAFT_NOT_FOUND", "Contract draft not found.");
    const values = draft.storedValues.contract;
    const validationState = readiness(values);
    if (!isComplete(values) || !validationState.ready) {
      throw new ContractDraftServiceError("CONTRACT_NOT_READY", "Review the required contract details before generating.", { errors: validationState.errors });
    }
    const finalizedAt = this.now();
    const rendered = this.render(values);
    const finalized = await this.dependencies.repository.finalizeDraft({
      draftId: draft.id,
      snapshot: {
        values,
        template: { stableKey: "adventure-zone-standard", version: draft.templateVersion },
        insuranceRecipient: draft.storedValues.insuranceRecipient,
        finalizedAt: finalizedAt.toISOString(),
      },
      renderedLegalText: rendered.text,
      signerSnapshot: rendered.signatureBlocks.map(({ name, role, email, order }) => ({ name, role, email, order, phone: "" })),
      actorId: input.actorId,
      finalizedAt,
    });
    if (finalized.version.status === "ready_for_adobe") return finalized;
    const pdf = await this.dependencies.generatePdf(values);
    await this.dependencies.files.storeGenerated({ contractVersionId: finalized.version.id, bytes: pdf.bytes, actorId: input.actorId });
    const version = await this.dependencies.repository.markReadyForAdobe(finalized.version.id, input.actorId, this.now());
    return { ...finalized, version };
  }

  async createReplacement(input: { contractVersionId: string; actorId: string }) {
    const version = await this.dependencies.repository.getVersion(input.contractVersionId);
    if (!version) throw new ContractDraftServiceError("CONTRACT_VERSION_NOT_FOUND", "Contract version not found.");
    const existing = await this.dependencies.repository.findOpenDraftByBooking(version.bookingId);
    if (existing) return existing;
    return this.dependencies.repository.createDraft({
      bookingId: version.bookingId,
      organizationId: version.organizationId,
      templateId: version.templateId,
      templateVersion: version.snapshot.template.version,
      storedValues: { contract: version.snapshot.values, insuranceRecipient: version.snapshot.insuranceRecipient },
      validationState: validateContractValues(version.snapshot.values),
      predecessorVersionId: version.id,
      actorId: input.actorId,
      now: this.now(),
    });
  }
}
