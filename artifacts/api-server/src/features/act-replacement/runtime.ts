import { randomUUID } from "node:crypto";

import type { ActPageRequest } from "@/features/act-migration/migration-types";
import { HttpActMigrationSourceClient } from "@/features/act-migration/source-client";
import type { ActClient } from "@/features/act-sync/act-client";
import type { ActReadTransport } from "./act-read-transport";
import { getActEnvironment } from "@/lib/env";
import type { ActReplacementStreamType } from "./import-types";
import type { ActExtractionSourceClient } from "./extraction-worker";

export interface ActExtractionRuntime {
  start(): void;
  close(): Promise<void>;
}

type ExtractionLoop = ActExtractionRuntime;

export const actExtractionWorkerConcurrency = 4;

export function createActExtractionLoopPool(input: {
  concurrency: number;
  createLoop(index: number): ExtractionLoop;
}): ActExtractionRuntime {
  const loops = Array.from({ length: input.concurrency }, (_, index) =>
    input.createLoop(index),
  );
  return {
    start() {
      for (const loop of loops) loop.start();
    },
    async close() {
      await Promise.all(loops.map((loop) => loop.close()));
    },
  };
}

type ShutdownStage = "runtime" | "server" | "pool";

export function createActServerShutdown(input: {
  closeRuntime(): Promise<void>;
  closeServer(): Promise<void>;
  closePool(): Promise<void>;
  onError(stage: ShutdownStage): void;
}): () => Promise<void> {
  let shutdown: Promise<void> | null = null;
  return () => {
    shutdown ??= (async () => {
      for (const [stage, close] of [
        ["runtime", input.closeRuntime],
        ["server", input.closeServer],
        ["pool", input.closePool],
      ] as const) {
        try {
          await close();
        } catch {
          try {
            input.onError(stage);
          } catch {
            // Shutdown remains best-effort even if reporting is unavailable.
          }
        }
      }
    })();
    return shutdown;
  };
}

const disabledRuntime: ActExtractionRuntime = {
  start() {},
  async close() {},
};

export function createActExtractionClientAdapter(
  client: Pick<
    ActClient,
    "authorize" | "getJsonAuthorized" | "hasValidAuthorization" | "rateLimit"
  >,
): {
  authorization: {
    isReady(now: Date): boolean;
    authorize(): Promise<void>;
  };
  source: ActExtractionSourceClient;
} {
  let authorizationInFlight: Promise<void> | null = null;
  const transport: ActReadTransport = {
    get rateLimit() {
      return client.rateLimit;
    },
    getJson: (input) => client.getJsonAuthorized(input),
  };
  const source = new HttpActMigrationSourceClient(transport);
  return {
    authorization: {
      isReady: (now) => client.hasValidAuthorization(now),
      authorize: () => {
        authorizationInFlight ??= client.authorize().finally(() => {
          authorizationInFlight = null;
        });
        return authorizationInFlight;
      },
    },
    source: {
      listRoot: (kind, request) => source.listRoot(kind, request),
      listContactNotes: (contactId, request) =>
        source.listNotesForContact(contactId, request),
      getDetail: (kind, id) => source.getDetail(kind, id),
      listRelationship: (input) =>
        listRelationship(
          source,
          input.streamType,
          input.parentId,
          input.request,
        ),
    },
  };
}

export async function createActExtractionRuntime(): Promise<ActExtractionRuntime> {
  const environment = getActEnvironment();
  if (!environment.configured) return disabledRuntime;

  const [
    { db },
    { ActClient },
    { DrizzleActReplacementCheckpointRepository },
    { DrizzleActSourceArchiveRepository },
    { DrizzleActRequestAuditRepository },
    { ActExtractionWorker },
    {
      ActExtractionWorkerLoop,
      ActOrganizerWorkerLoop,
      systemWorkerLoopScheduler,
    },
    { ProductionActOrganizer, ProductionActOrganizerRecoveryWorker },
    { DrizzleProductionOrganizerStore },
  ] = await Promise.all([
    import("@/db/client"),
    import("@/features/act-sync/act-client"),
    import("./checkpoint-repository"),
    import("./archive-repository"),
    import("./request-audit-repository"),
    import("./extraction-worker"),
    import("./worker-loop"),
    import("./production-organizer"),
    import("./review-sql-adapter"),
  ]);

  const clientAdapter = createActExtractionClientAdapter(
    new ActClient(environment.config),
  );
  const clock = { now: () => new Date() };
  const worker = new ActExtractionWorker({
    checkpoints: new DrizzleActReplacementCheckpointRepository(db),
    audits: new DrizzleActRequestAuditRepository(db),
    source: clientAdapter.source,
    archive: new DrizzleActSourceArchiveRepository(db),
    authorization: clientAdapter.authorization,
    clock,
  });
  const extractionLoop = createActExtractionLoopPool({
    concurrency: actExtractionWorkerConcurrency,
    createLoop: (index) =>
      new ActExtractionWorkerLoop({
        worker,
        workerId: `act-extraction-${process.pid}-${index}-${randomUUID()}`,
        clock,
        scheduler: systemWorkerLoopScheduler,
      }),
  });
  const organizerStore = new DrizzleProductionOrganizerStore(db, {
    sourceDatabaseKey: environment.config.databaseName,
  });
  const organizer = new ProductionActOrganizer(organizerStore);
  const organizerLoop = new ActOrganizerWorkerLoop({
    worker: new ProductionActOrganizerRecoveryWorker({
      findRecoverableRunId: (now) => organizerStore.findRecoverableRunId(now),
      organize: (runId) => organizer.organize(runId),
    }),
    workerId: `act-organizer-${process.pid}-${randomUUID()}`,
    clock,
    scheduler: systemWorkerLoopScheduler,
  });
  return {
    start() {
      extractionLoop.start();
      organizerLoop.start();
    },
    async close() {
      await Promise.all([organizerLoop.close(), extractionLoop.close()]);
    },
  };
}

type SourceClient = HttpActMigrationSourceClient;

function listRelationship(
  source: SourceClient,
  streamType: ActReplacementStreamType,
  parentId: string,
  request: ActPageRequest,
) {
  switch (streamType) {
    case "company_contact":
      return source.listCompaniesForContact(parentId, request);
    case "opportunity_company":
      return source.listCompaniesForOpportunity(parentId, request);
    case "opportunity_contact":
      return source.listContactsForOpportunity(parentId, request);
    case "group_contact":
      return source.listContactsForGroup(parentId, request);
    case "activity_contact":
      return source.listContactsForActivity(parentId, request);
    case "activity_company":
      return source.listCompaniesForActivity(parentId, request);
    case "activity_opportunity":
      return source.listRelated({
        parentKind: "activity",
        parentId,
        targetKind: "opportunity",
        request,
      });
    case "note_contact":
      return source.listContactsForNote(parentId, request);
    case "note_company":
      return source.listCompaniesForNote(parentId, request);
    case "note_opportunity":
      return source.listRelated({
        parentKind: "note",
        parentId,
        targetKind: "opportunity",
        request,
      });
    case "history_contact":
      return source.listContactsForHistory(parentId, request);
    case "history_company":
      return source.listCompaniesForHistory(parentId, request);
    case "history_opportunity":
      return source.listRelated({
        parentKind: "history",
        parentId,
        targetKind: "opportunity",
        request,
      });
    default:
      throw new Error("Act relationship checkpoint is invalid.");
  }
}
