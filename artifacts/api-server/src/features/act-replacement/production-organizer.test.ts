import { describe, expect, it, vi } from "vitest";
import type {
  ActOrganizeManifest,
  ManifestSourceInput,
} from "./manifest-builder";
import {
  ProductionActOrganizer,
  ProductionActOrganizerRecoveryWorker,
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
  readonly renewedTokens: string[] = [];
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

  async renew(_runId: string, claimToken: string) {
    this.renewedTokens.push(claimToken);
    return true;
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
  it("acknowledges a claimed run before slow source loading finishes", async () => {
    let finishLoading!: (sources: readonly ManifestSourceInput[]) => void;
    const loading = new Promise<readonly ManifestSourceInput[]>((resolve) => {
      finishLoading = resolve;
    });
    let completed = false;
    const store: ProductionOrganizerStore = {
      async claim(runId) {
        return { runId, phase: "organizing", claimToken: "background-token" };
      },
      async loadSources() { return loading; },
      async renew() { return true; },
      async persistManifest() {},
      async complete() { completed = true; },
      async release() {},
    };

    const started = await new ProductionActOrganizer(store).start("run-background");

    expect(started.status).toBe("organizing");
    expect(completed).toBe(false);
    finishLoading([companySource]);
    await started.finished;
    expect(completed).toBe(true);
  });

  it("renews the durable lease immediately before manifest persistence", async () => {
    const events: string[] = [];
    const store: ProductionOrganizerStore = {
      async claim(runId) { return { runId, phase: "organizing", claimToken: "renew-token" }; },
      async loadSources() { events.push("load"); return [companySource]; },
      async renew(_runId, claimToken) { events.push(`renew:${claimToken}`); return true; },
      async persistManifest() { events.push("persist"); },
      async complete() { events.push("complete"); },
      async release() {},
    };

    await new ProductionActOrganizer(store).organize("run-renew");

    expect(events).toEqual(["load", "renew:renew-token", "persist", "complete"]);
  });

  it("uses the final renewal as authority after a transient heartbeat error", async () => {
    vi.useFakeTimers();
    try {
      let finishLoading!: (sources: readonly ManifestSourceInput[]) => void;
      const loading = new Promise<readonly ManifestSourceInput[]>((resolve) => {
        finishLoading = resolve;
      });
      let renewCalls = 0;
      let released = false;
      const store: ProductionOrganizerStore = {
        async claim(runId) {
          return { runId, phase: "organizing", claimToken: "heartbeat-token" };
        },
        async loadSources() { return loading; },
        async renew() {
          renewCalls += 1;
          if (renewCalls === 1) throw new Error("temporary_database_error");
          return true;
        },
        async persistManifest() {},
        async complete() {},
        async release() { released = true; },
      };

      const organizing = new ProductionActOrganizer(store).organize("run-heartbeat");
      await vi.advanceTimersByTimeAsync(60_000);
      finishLoading([companySource]);

      await expect(organizing).resolves.toMatchObject({ status: "ready_to_apply" });
      expect(renewCalls).toBe(2);
      expect(released).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a nested persistence error code when releasing a failed organizer claim", async () => {
    let releasedCode: string | null = null;
    const store: ProductionOrganizerStore = {
      async claim(runId) { return { runId, phase: "organizing", claimToken: "nested-error-token" }; },
      async loadSources() { return [companySource]; },
      async renew() { return true; },
      async persistManifest() {
        throw Object.assign(new Error("transaction_failed"), {
          cause: Object.assign(new Error("terminal_operation_key_collision"), {
            code: "terminal_operation_key_collision",
          }),
        });
      },
      async complete() {},
      async release(_runId, _claimToken, code) { releasedCode = code; },
    };

    await expect(new ProductionActOrganizer(store).organize("run-nested-error"))
      .rejects.toThrow("transaction_failed");
    expect(releasedCode).toBe("terminal_operation_key_collision");
  });

  it("automatically resumes expired durable organizing work", async () => {
    const organize = async (runId: string) => {
      expect(runId).toBe("run-expired");
      return { status: "ready_to_apply" as const, manifest: { digest: "d", diagnostics: [], outcomes: [], operations: [] } };
    };
    const worker = new ProductionActOrganizerRecoveryWorker({
      findRecoverableRunId: async () => "run-expired",
      organize,
    });

    await expect(worker.runOne({ workerId: "recovery", now: new Date() }))
      .resolves.toEqual({ kind: "progress" });
  });

  it("builds one deterministic manifest from complete archived sources", async () => {
    const store = new InMemoryProductionOrganizerStore({
      runId: "run-1",
      phase: "extract_complete",
      sources: [companySource, contactSource, noteSource],
    });
    const shuffledStore = new InMemoryProductionOrganizerStore({
      runId: "run-shuffled",
      phase: "extract_complete",
      sources: [noteSource, companySource, contactSource],
    });
    const organizer = new ProductionActOrganizer(store);

    const first = await organizer.organize("run-1");
    const second = await organizer.organize("run-1");
    const shuffled = await new ProductionActOrganizer(shuffledStore).organize("run-shuffled");

    expect(first.status).toBe("ready_to_apply");
    expect(second.manifest.digest).toBe(first.manifest.digest);
    expect(shuffled.manifest).toEqual(first.manifest);
    expect(store.persistedOperationKeys).toEqual([
      "organization:company-1",
      "contact:contact-1",
      "activity:note-1",
      expect.stringMatching(/^organization_contact:contact-1:company-1:revision:/),
      expect.stringMatching(/^activity_association:note-1:contact-1:revision:/),
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
      async renew() { return true; },
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
