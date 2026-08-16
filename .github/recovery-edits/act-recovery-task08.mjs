import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`No change: ${path}`);
    return;
  }
  await writeFile(path, after);
  console.log(`Updated: ${path}`);
}

function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`Missing ${label}`);
  return text.replace(before, after);
}

await edit("artifacts/api-server/src/features/act-replacement/runtime.ts", (text) => {
  text = replaceRequired(
    text,
    `  systemWorkerLoopScheduler,\n  type WorkerLoopScheduler,\n} from "./worker-loop";`,
    `  systemWorkerLoopScheduler,\n  type OrganizerLoopWorker,\n  type WorkerLoopScheduler,\n} from "./worker-loop";`,
    "organizer worker type import",
  );

  const profileLoop = `export function createArchiveProfileImportLoop(input: {\n  store: ArchiveProfileImportStore;\n  createAiClient(): Promise<AiCompletionClient>;\n  clock: { now(): Date };\n  scheduler?: WorkerLoopScheduler;\n}): ActExtractionRuntime {\n  return new ActOrganizerWorkerLoop({\n    worker: new ArchiveProfileImportWorker({\n      store: input.store,\n      createAiClient: input.createAiClient,\n      clock: input.clock,\n    }),\n    workerId: \`act-archive-profile-import-\${process.pid}-\${randomUUID()}\`,\n    clock: input.clock,\n    scheduler: input.scheduler ?? systemWorkerLoopScheduler,\n  });\n}\n`;
  const profileAndRecoveryLoops = `${profileLoop}\nexport function createActArchiveRecoveryLoop(input: {\n  worker: OrganizerLoopWorker;\n  clock: { now(): Date };\n  scheduler?: WorkerLoopScheduler;\n}): ActExtractionRuntime {\n  return new ActOrganizerWorkerLoop({\n    worker: input.worker,\n    workerId: \`act-archive-recovery-\${process.pid}-\${randomUUID()}\`,\n    clock: input.clock,\n    scheduler: input.scheduler ?? systemWorkerLoopScheduler,\n  });\n}\n`;
  text = replaceRequired(text, profileLoop, profileAndRecoveryLoops, "archive recovery loop helper");

  const oldProduction = `async function createProductionArchiveRuntime(): Promise<ActExtractionRuntime> {\n  const [\n    { db },\n    { DrizzleArchiveProfileImportRepository },\n    { createAiClient },\n  ] = await Promise.all([\n    import("@/db/client"),\n    import("./archive-profile-import-repository"),\n    import("../ai-suggestions/ai-client"),\n  ]);\n  const clock = { now: () => new Date() };\n  const archiveProfileImportLoop = createArchiveProfileImportLoop({\n    store: new DrizzleArchiveProfileImportRepository(db),\n    createAiClient,\n    clock,\n  });\n  return archiveProfileImportLoop;\n}\n`;
  const newProduction = `async function createProductionArchiveRuntime(): Promise<ActExtractionRuntime> {\n  const [\n    { db },\n    { DrizzleArchiveProfileImportRepository },\n    { createAiClient },\n    { DrizzleActArchiveRecoveryRepository },\n    { ActRecoverySourceLinkResolver },\n    { ActEntityRecovery },\n    { ActRelationshipRecovery },\n    { ActTimelineRecovery },\n    { ActArchiveRecoveryWorker },\n  ] = await Promise.all([\n    import("@/db/client"),\n    import("./archive-profile-import-repository"),\n    import("../ai-suggestions/ai-client"),\n    import("../act-recovery/recovery-repository"),\n    import("../act-recovery/source-link-resolver"),\n    import("../act-recovery/entity-recovery"),\n    import("../act-recovery/relationship-recovery"),\n    import("../act-recovery/timeline-recovery"),\n    import("../act-recovery/recovery-worker"),\n  ]);\n  const clock = { now: () => new Date() };\n  const archiveProfileImportLoop = createArchiveProfileImportLoop({\n    store: new DrizzleArchiveProfileImportRepository(db),\n    createAiClient,\n    clock,\n  });\n  const resolver = new ActRecoverySourceLinkResolver(db);\n  const archiveRecoveryLoop = createActArchiveRecoveryLoop({\n    worker: new ActArchiveRecoveryWorker({\n      repository: new DrizzleActArchiveRecoveryRepository(db),\n      entityRecovery: new ActEntityRecovery(db, resolver),\n      relationshipRecovery: new ActRelationshipRecovery(db, resolver),\n      timelineRecovery: new ActTimelineRecovery(db, resolver),\n    }),\n    clock,\n  });\n  return {\n    start() {\n      archiveProfileImportLoop.start();\n      archiveRecoveryLoop.start();\n    },\n    async close() {\n      await Promise.all([archiveRecoveryLoop.close(), archiveProfileImportLoop.close()]);\n    },\n  };\n}\n`;
  text = replaceRequired(text, oldProduction, newProduction, "production archive recovery composition");
  return text;
});
