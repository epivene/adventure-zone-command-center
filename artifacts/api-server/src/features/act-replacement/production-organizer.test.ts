import { describe, expect, it } from "vitest";
import type {
  ActOrganizeManifest,
  ManifestSourceInput,
} from "./manifest-builder";
import {
  ProductionActOrganizer,
  type OrganizerRun,
  type ProductionOrganizerStore,
} from "./production-organizer";

const companySource: ManifestSourceInput = {
  sourceRecordId: "company-1",
  sourceVersionId: "company-version-1",
  streamType: "company",
  normalized: { kind: "organization", name: "Adventure Zone" },
  match: { kind: "none", reason: "no_candidate" },
};

const contactSource: ManifestSourceInput = {
  sourceRecordId: "contact-1",
  sourceVersionId: "contact-version-1",
  streamType: "contact",
  normalized: { kind: "contact", firstName: "Taako", lastName: "Taaco" },
  match: { kind: "none", reason: "no_candidate" },
  relationships: { organizationSourceIds: ["company-1"] },
};

const noteSource: ManifestSourceInput = {
  sourceRecordId: "note-1",
  sourceVersionId: "note-version-1",
  streamType: "note",
  normalized: {
    kind: "timeline",
    category: "note",
    sourceType: "note",
    body: "Meet at the moon base.",
    timelineSortAt: "2026-08-07T12:00:00.000Z",
  },
  match: { kind: "none", reason: "no_candidate" },
  relationships: { contactSourceIds: ["contact-1"] },
};

class InMemoryProductionOrganizerStore implements ProductionOrganizerStore {
  readonly persistedOperationKeys: string[] = [];
  private manifest: ActOrganizeManifest | null = null;
  private readonly run: OrganizerRun;

  constructor(input: {
    runId: string;
    phase: OrganizerRun["phase"];
    sources: readonly ManifestSourceInput[];
  }) {
    this.run = { runId: input.runId, phase: input.phase, claimToken: "claim-one" };
    this.sources = input.sources;
  }

  private readonly sources: readonly ManifestSourceInput[];

  async claim(runId: string) {
    return runId === this.run.runId ? this.run : null;
  }

  async loadSources() {
    return this.sources;
  }

  async persistManifest(_runId: string, claimToken: string, manifest: ActOrganizeManifest) {
    expect(claimToken).toBe("claim-one");
    this.manifest = manifest;
    this.persistedOperationKeys.splice(
      0,
      this.persistedOperationKeys.length,
      ...manifest.operations
        .filter((operation) => operation.requiredForSourceOutcome)
        .map((operation) => operation.operationKey),
    );
  }

  async complete(_runId: string, claimToken: string) { expect(claimToken).toBe("claim-one"); }

  async release(_runId: string, claimToken: string) { expect(claimToken).toBe("claim-one"); }
}

describe("ProductionActOrganizer", () => {
  it("builds one deterministic manifest from complete archived sources", async () => {
    const store = new InMemoryProductionOrganizerStore({
      runId: "run-1",
      phase: "extract_complete",
      sources: [companySource, contactSource, noteSource],
    });
    const organizer = new ProductionActOrganizer(store);

    const first = await organizer.organize("run-1");
    const second = await organizer.organize("run-1");

    expect(first.status).toBe("ready_to_apply");
    expect(second.manifest.digest).toBe(first.manifest.digest);
    expect(store.persistedOperationKeys).toEqual([
      "organization:company-1",
      "contact:contact-1",
      "activity:note-1",
      "organization_contact:contact-1:company-1",
      "activity_association:note-1:contact-1",
    ]);
    expect(new Set(store.persistedOperationKeys).size).toBe(
      store.persistedOperationKeys.length,
    );
  });

  it("keeps review-required outcomes visible without blocking apply readiness", async () => {
    const store = new InMemoryProductionOrganizerStore({
      runId: "run-review",
      phase: "extract_complete",
      sources: [
        companySource,
        {
          ...contactSource,
          match: {
            kind: "ambiguous",
            candidateIds: ["local-contact-2", "local-contact-1"],
            reason: "duplicate_email",
          },
        },
      ],
    });

    const result = await new ProductionActOrganizer(store).organize(
      "run-review",
    );

    expect(result.status).toBe("ready_to_apply");
    expect(result.manifest.outcomes).toContainEqual(
      expect.objectContaining({
        sourceRecordId: "contact-1",
        state: "awaiting_review",
      }),
    );
  });

  it("passes one exclusive claim token through persistence and conditional completion", async () => {
    let active = false;
    let completedToken: string | null = null;
    const store: ProductionOrganizerStore = {
      async claim(runId) {
        if (active) return null;
        active = true;
        return { runId, phase: "organizing", claimToken: "exclusive-token" };
      },
      async loadSources() { return [companySource]; },
      async persistManifest(_runId, claimToken) { expect(claimToken).toBe("exclusive-token"); },
      async complete(_runId, claimToken) { completedToken = claimToken; active = false; },
      async release() { active = false; },
    };
    const organizer = new ProductionActOrganizer(store);

    const first = organizer.organize("run-exclusive");
    await expect(organizer.organize("run-exclusive")).rejects.toMatchObject({ code: "organize_unavailable" });
    await expect(first).resolves.toMatchObject({ status: "ready_to_apply" });
    expect(completedToken).toBe("exclusive-token");
  });
});
