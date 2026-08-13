import {
  buildActOrganizeManifest,
  type ActOrganizeManifest,
  type ManifestSourceInput,
} from "./manifest-builder";

export type OrganizerRun = {
  runId: string;
  phase: "extract_complete" | "organizing";
  claimToken: string;
};

export interface ProductionOrganizerStore {
  claim(runId: string): Promise<OrganizerRun | null>;
  loadSources(runId: string): Promise<readonly ManifestSourceInput[]>;
  renew(runId: string, claimToken: string): Promise<boolean>;
  /** Atomically persists the rows and publishes the run's ready digest. */
  persistManifest(runId: string, claimToken: string, manifest: ActOrganizeManifest): Promise<void>;
  complete(
    runId: string,
    claimToken: string,
    phase: "ready_to_apply",
    digest: string,
  ): Promise<void>;
  release(runId: string, claimToken: string, code: string): Promise<void>;
}

function codedError(code: string, status: number) {
  return Object.assign(new Error(code), { code, status });
}

export function organizerErrorCode(error: unknown) {
  const visited = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return "organize_failed";
}

export class ProductionActOrganizer {
  constructor(private readonly store: ProductionOrganizerStore) {}

  async start(runId: string): Promise<{
    status: "organizing";
    finished: Promise<{
      status: "ready_to_apply" | "complete_with_issues";
      manifest: ActOrganizeManifest;
    }>;
  }> {
    const run = await this.store.claim(runId);
    if (!run) throw codedError("organize_unavailable", 409);
    return {
      status: "organizing",
      finished: this.organizeClaimed(run),
    };
  }

  async organize(runId: string): Promise<{
    status: "ready_to_apply" | "complete_with_issues";
    manifest: ActOrganizeManifest;
  }> {
    const run = await this.store.claim(runId);
    if (!run) throw codedError("organize_unavailable", 409);
    return this.organizeClaimed(run);
  }

  private async organizeClaimed(run: OrganizerRun): Promise<{
    status: "ready_to_apply" | "complete_with_issues";
    manifest: ActOrganizeManifest;
  }> {
    let claimLost = false;
    const heartbeat = setInterval(() => {
      void this.store.renew(run.runId, run.claimToken).then(
        (renewed) => {
          if (!renewed) claimLost = true;
        },
        () => {
          // A transient database error does not prove ownership was lost. The
          // authoritative renewal immediately before persistence decides that.
        },
      );
    }, 60_000);
    heartbeat.unref?.();
    const stopHeartbeat = () => clearInterval(heartbeat);
    try {
      const sources = await this.store.loadSources(run.runId);
      const manifest = buildActOrganizeManifest({ runId: run.runId, sources });
      if (claimLost) throw codedError("organizer_claim_lost", 409);
      if (!(await this.store.renew(run.runId, run.claimToken)))
        throw codedError("organizer_claim_lost", 409);
      await this.store.persistManifest(run.runId, run.claimToken, manifest);
      const status = "ready_to_apply" as const;
      return { status, manifest };
    } catch (error) {
      stopHeartbeat();
      await this.store.release(run.runId, run.claimToken, organizerErrorCode(error));
      throw error;
    } finally {
      stopHeartbeat();
    }
  }
}

export class ProductionActOrganizerRecoveryWorker {
  constructor(private readonly dependencies: {
    findRecoverableRunId(now: Date): Promise<string | null>;
    organize(runId: string): Promise<unknown>;
  }) {}

  async runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "progress" }> {
    const runId = await this.dependencies.findRecoverableRunId(input.now);
    if (!runId) return { kind: "idle" };
    try {
      await this.dependencies.organize(runId);
      return { kind: "progress" };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "organize_unavailable"
      ) return { kind: "idle" };
      throw error;
    }
  }
}
