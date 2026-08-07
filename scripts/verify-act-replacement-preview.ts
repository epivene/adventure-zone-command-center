#!/usr/bin/env tsx

export const REQUIRED_ROOTS = [
  "company",
  "contact",
  "opportunity",
  "group",
  "activity",
  "note",
  "history",
] as const;

export type PreviewCounters = {
  responseRows: number;
  observedIdentities: number;
  archivedIdentities: number;
  completeIdentities: number;
  partialIdentities: number;
  failedIdentities: number;
  snapshotVersionsInserted: number;
};
export type PreviewStream = PreviewCounters & {
  streamType: string;
  state: string;
  completedCheckpoints: number;
  totalCheckpoints: number;
  error: unknown;
};
export type PreviewStatus = {
  runId: string;
  phase: string;
  previewOnly: boolean;
  streams: PreviewStream[];
  allStreams: PreviewCounters & { unsupportedCapabilities: number };
  /** Optional production gate evidence returned by newer API summaries. */
  applyEnabled?: boolean;
  applyBatches?: Array<{ state?: string }>;
  requiredStreams?: string[];
  leaseSummary?: { active: number; expired: number };
  operations?: Array<{
    operationKey: string;
    sourceVersionId: string | null;
    targetType: string;
    status:
      | "pending"
      | "leased"
      | "applied"
      | "already_present"
      | "blocked"
      | "failed";
    requiredForSourceOutcome: boolean;
    heldForReview?: boolean;
    dependencyOperationKeys?: string[];
    safeByDefault?: boolean;
  }>;
  durableAdapters?: {
    reviewReader?: boolean;
    commandService?: boolean;
    applyRepository?: boolean;
  };
};
export type PreviewAudit = {
  auditId: string;
  method: string;
  state: string;
  httpStatus: number | null;
  pathTemplate: string;
};
export type PreviewVerification = { ok: boolean; errors: string[] };
export type VerificationMode = "pre_apply" | "post_apply";

function checkCounters(
  label: string,
  counters: PreviewCounters,
  errors: string[],
) {
  if (counters.observedIdentities !== counters.archivedIdentities) {
    errors.push(
      `${label} observed identities do not equal archived identities`,
    );
  }
  if (
    counters.completeIdentities +
      counters.partialIdentities +
      counters.failedIdentities !==
    counters.observedIdentities
  ) {
    errors.push(`${label} completeness does not partition observations`);
  }
}

export function verifyActReplacementPreview(
  status: PreviewStatus,
  audits: readonly PreviewAudit[],
  mode: VerificationMode = "pre_apply",
): PreviewVerification {
  const errors: string[] = [];
  if (!status.previewOnly) errors.push("run is not preview-only");
  if (mode === "pre_apply" && status.phase !== "ready_to_apply")
    errors.push("pre-apply run is not ready");
  if (
    mode === "post_apply" &&
    status.phase !== "complete" &&
    status.phase !== "complete_with_issues"
  )
    errors.push("post-apply run is not complete");
  if (status.applyEnabled === undefined)
    errors.push("production apply setting is unavailable");
  else if (status.applyEnabled) errors.push("production apply is enabled");
  if (!status.applyBatches) {
    errors.push("apply batch evidence is unavailable");
  } else {
    const terminalBatchStates = new Set(["complete", "complete_with_issues"]);
    if (
      status.applyBatches.some(
        (batch) =>
          batch.state === "queued" || batch.state === "applying",
      )
    ) {
      errors.push("active apply batch remains");
    }
    if (
      status.applyBatches.some(
        (batch) =>
          typeof batch.state !== "string" ||
          !terminalBatchStates.has(batch.state),
      )
    ) {
      errors.push("apply batch is not terminal");
    }
  }
  if (!status.durableAdapters) {
    errors.push("durable review/apply adapter evidence is unavailable");
  } else if (
    !status.durableAdapters.reviewReader ||
    !status.durableAdapters.commandService ||
    !status.durableAdapters.applyRepository
  ) {
    errors.push("durable review/apply adapters are unavailable");
  }
  const streams = new Map(
    status.streams.map((stream) => [stream.streamType, stream]),
  );
  if (!status.requiredStreams?.length)
    errors.push("required stream inventory is unavailable");
  const requiredRoots = new Set<string>(REQUIRED_ROOTS);
  for (const streamType of status.requiredStreams ?? []) {
    requiredRoots.add(streamType);
  }
  for (const root of requiredRoots) {
    const stream = streams.get(root);
    if (!stream) {
      errors.push(`required root ${root} is missing`);
      continue;
    }
    if (
      stream.state !== "complete" ||
      stream.totalCheckpoints <= 0 ||
      stream.completedCheckpoints !== stream.totalCheckpoints ||
      stream.error !== null
    ) {
      errors.push(`required root ${root} is not complete`);
    }
    if (stream.partialIdentities > 0)
      errors.push(`required root ${root} has partial identities`);
    if (stream.failedIdentities > 0)
      errors.push(`required root ${root} has failed identities`);
  }
  for (const stream of status.streams) {
    checkCounters(stream.streamType, stream, errors);
    if (
      !(REQUIRED_ROOTS as readonly string[]).includes(stream.streamType) &&
      stream.state === "failed"
    ) {
      errors.push(`optional stream ${stream.streamType} failed`);
    }
    if (!requiredRoots.has(stream.streamType) && stream.partialIdentities > 0)
      errors.push(`optional stream ${stream.streamType} has partial identities`);
    if (!requiredRoots.has(stream.streamType) && stream.failedIdentities > 0)
      errors.push(`optional stream ${stream.streamType} has failed identities`);
  }
  checkCounters("all-stream", status.allStreams, errors);
  const aggregateKeys: Array<keyof PreviewCounters> = [
    "responseRows", "observedIdentities", "archivedIdentities", "completeIdentities",
    "partialIdentities", "failedIdentities", "snapshotVersionsInserted",
  ];
  for (const key of aggregateKeys) {
    const streamTotal = status.streams.reduce((sum, stream) => sum + stream[key], 0);
    if (status.allStreams[key] !== streamTotal)
      errors.push(`all-stream ${key} does not equal advertised stream total`);
  }
  const contact = streams.get("contact");
  if (!contact || contact.observedIdentities <= 0)
    errors.push("contact count is zero");

  if (!status.leaseSummary) {
    errors.push("lease evidence is unavailable");
  } else {
    if (status.leaseSummary.active !== 0) errors.push("active leases remain");
    if (status.leaseSummary.expired !== 0) errors.push("expired leases remain");
  }

  const relationshipTargets = new Set([
    "organization_contact",
    "booking_contact",
    "calling_list_member",
    "activity_association",
  ]);
  if (!status.operations) {
    errors.push("operation evidence is unavailable");
  } else {
    const operations = new Map(status.operations.map((operation) => [operation.operationKey, operation]));
    const readyBeforeApply = (operationKey: string, trail = new Set<string>()): boolean => {
      const operation = operations.get(operationKey);
      if (!operation || trail.has(operationKey) || operation.heldForReview === true || !operation.sourceVersionId?.trim()) return false;
      if (operation.status === "applied" || operation.status === "already_present") return true;
      if (operation.status !== "pending" || operation.safeByDefault !== true) return false;
      const next = new Set(trail); next.add(operationKey);
      return (operation.dependencyOperationKeys ?? []).every((dependency) => readyBeforeApply(dependency, next));
    };
    for (const operation of status.operations) {
      if (
        (operation.status === "applied" ||
          operation.status === "already_present") &&
        !operation.sourceVersionId?.trim()
      ) {
        errors.push("applied operation is missing a source version");
      }
      if (
        mode === "pre_apply" &&
        operation.requiredForSourceOutcome &&
        relationshipTargets.has(operation.targetType) &&
        operation.heldForReview !== true &&
        !readyBeforeApply(operation.operationKey)
      ) {
        errors.push("required relationship operation is unresolved");
      }
      if (
        mode === "post_apply" &&
        operation.requiredForSourceOutcome &&
        operation.heldForReview !== true &&
        operation.status !== "applied" &&
        operation.status !== "already_present"
      ) {
        errors.push("required operation is not terminal");
      }
    }
  }

  for (const audit of audits) {
    if (audit.method !== "GET") errors.push("audit contains a non-GET method");
    if (audit.state !== "succeeded")
      errors.push("audit contains an unsuccessful request");
    if (
      audit.httpStatus !== null &&
      (audit.httpStatus < 200 || audit.httpStatus >= 300)
    ) {
      errors.push("audit contains a non-success HTTP status");
    }
    if (!audit.pathTemplate.startsWith("/"))
      errors.push("audit contains an invalid path");
    if (
      /password|secret|token|authorization|cookie|body|raw/i.test(
        audit.pathTemplate,
      )
    )
      errors.push("audit contains a sensitive path");
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function endpoint(base: string, path: string) {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

async function getJson<T>(url: string, token: string | undefined): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`preview endpoint returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchAndVerifyPreview(input: {
  baseUrl: string;
  runId?: string;
  ownerToken?: string;
  mode?: VerificationMode;
}): Promise<PreviewVerification> {
  let runId = input.runId;
  if (!runId) {
    const latest = await getJson<{ run: PreviewStatus | null }>(
      endpoint(input.baseUrl, "/migration/act-replacement/runs/latest"),
      input.ownerToken,
    );
    runId = latest.run?.runId;
  }
  if (!runId) throw new Error("no durable Act replacement run found");
  const result = await getJson<{ run: PreviewStatus }>(
    endpoint(
      input.baseUrl,
      `/migration/act-replacement/runs/${encodeURIComponent(runId)}`,
    ),
    input.ownerToken,
  );
  const audits = await getJson<{ audits: PreviewAudit[] }>(
    endpoint(
      input.baseUrl,
      `/migration/act-replacement/runs/${encodeURIComponent(runId)}/request-audit`,
    ),
    input.ownerToken,
  );
  return verifyActReplacementPreview(
    result.run,
    audits.audits,
    input.mode ?? "pre_apply",
  );
}

async function main() {
  const mode = process.env.ACT_VERIFY_MODE ?? "pre_apply";
  if (mode !== "pre_apply" && mode !== "post_apply")
    throw new Error("ACT_VERIFY_MODE must be pre_apply or post_apply");
  const verification = await fetchAndVerifyPreview({
    baseUrl: process.env.ACT_PREVIEW_BASE_URL ?? "http://localhost:10000/api",
    runId: process.env.ACT_PREVIEW_RUN_ID,
    ownerToken: process.env.ACT_PREVIEW_OWNER_TOKEN,
    mode,
  });
  if (!verification.ok) {
    console.error(
      `Act preview verification failed (${verification.errors.length} checks):`,
    );
    for (const error of verification.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Act replacement ${mode === "pre_apply" ? "readiness" : "completion"} verification passed.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Act preview verification failed",
    );
    process.exitCode = 1;
  });
}
