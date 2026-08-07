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

function safeOrganizerError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "organize_failed";
}

export class ProductionActOrganizer {
  constructor(private readonly store: ProductionOrganizerStore) {}

  async organize(runId: string): Promise<{
    status: "ready_to_apply" | "complete_with_issues";
    manifest: ActOrganizeManifest;
  }> {
    const run = await this.store.claim(runId);
    if (!run) throw codedError("organize_unavailable", 409);
    try {
      const sources = await this.store.loadSources(runId);
      const manifest = buildActOrganizeManifest({ runId, sources });
      await this.store.persistManifest(runId, run.claimToken, manifest);
      const status = "ready_to_apply" as const;
      await this.store.complete(runId, run.claimToken, status, manifest.digest);
      return { status, manifest };
    } catch (error) {
      await this.store.release(runId, run.claimToken, safeOrganizerError(error));
      throw error;
    }
  }
}
