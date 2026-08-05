import type { ActApplyService } from "./apply-service";
import { DrizzleActReviewCommandStore, DrizzleActReviewReader } from "./review-sql-adapter";
import { ReviewCommandService } from "./review-command-service";
import type { ReviewCommandStore } from "./review-command-service";
import type { ReviewReader } from "./review-reader";
import { createDrizzleApplyRepository } from "./drizzle-apply-repository";
import { ActApplyService as ApplyService } from "./apply-service";

type Scope = { sourceDatabaseKey: string };
type ScopeProvider = Scope | (() => Scope);

/**
 * Production review wiring is lazy so importing the Express router does not
 * require DATABASE_URL (important for route tests and preview-only builds).
 * The apply service is constructed for approval/replay support, but the route
 * still enforces ACT_MIGRATION_APPLY_ENABLED before any write operation.
 */
class LazyReviewRuntime {
  private readonly runtimes = new Map<string, Promise<{ reader: ReviewReader; commands: ReviewCommandService }>>();

  private runtime(scope: Scope) {
    const key = scope.sourceDatabaseKey;
    let current = this.runtimes.get(key);
    if (!current) {
      current = import("@/db/client").then(({ db }) => {
        const reader = new DrizzleActReviewReader(db, scope);
        const applyRepository = createDrizzleApplyRepository(db, { manifestDigest: async (runId) => (await reader.getManifest(runId))?.digest ?? null });
        const applyService: ActApplyService = new ApplyService(applyRepository, process.env.ACT_MIGRATION_APPLY_ENABLED === "true");
        const store: ReviewCommandStore = new DrizzleActReviewCommandStore(db, scope, applyService);
        return { reader, commands: new ReviewCommandService(store) };
      });
      this.runtimes.set(key, current);
    }
    return current;
  }

  reader(scopeProvider: ScopeProvider): ReviewReader {
    const scope = () => typeof scopeProvider === "function" ? scopeProvider() : scopeProvider;
    return {
      getManifest: (runId) => this.runtime(scope()).then((runtime) => runtime.reader.getManifest(runId)),
      listSources: (runId) => this.runtime(scope()).then((runtime) => runtime.reader.listSources(runId)),
      getSource: (sourceRecordId) => this.runtime(scope()).then((runtime) => runtime.reader.getSource?.(sourceRecordId) ?? null),
    };
  }

  commands(scopeProvider: ScopeProvider): ReviewCommandService {
    const scope = () => typeof scopeProvider === "function" ? scopeProvider() : scopeProvider;
    // The route only calls methods after a configured database is available.
    // A proxy preserves the existing service type while keeping DB creation lazy.
    return new Proxy(Object.create(ReviewCommandService.prototype) as ReviewCommandService, {
      get: (_target, property) => {
        if (typeof property !== "string") return undefined;
        return (...args: unknown[]) => this.runtime(scope()).then((runtime) => {
          const method = (runtime.commands as unknown as Record<string, unknown>)[property];
          if (typeof method !== "function") return method;
          return (method as (...values: unknown[]) => unknown).apply(runtime.commands, args);
        });
      },
    });
  }
}

const lazy = new LazyReviewRuntime();

export function createProductionReview(scope: ScopeProvider) {
  return { reader: lazy.reader(scope), commands: lazy.commands(scope) };
}
