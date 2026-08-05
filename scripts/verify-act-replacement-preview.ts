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

function checkCounters(label: string, counters: PreviewCounters, errors: string[]) {
  if (counters.observedIdentities !== counters.archivedIdentities) {
    errors.push(`${label} observed identities do not equal archived identities`);
  }
  if (
    counters.completeIdentities + counters.partialIdentities + counters.failedIdentities !==
    counters.observedIdentities
  ) {
    errors.push(`${label} completeness does not partition observations`);
  }
}

export function verifyActReplacementPreview(
  status: PreviewStatus,
  audits: readonly PreviewAudit[],
): PreviewVerification {
  const errors: string[] = [];
  if (!status.previewOnly) errors.push("run is not preview-only");
  if (status.phase === "applying") errors.push("run is not a preview extraction");
  if (status.applyEnabled === true) errors.push("production apply is enabled");
  if ((status.applyBatches ?? []).length > 0) errors.push("production apply batches must be empty");
  if (status.durableAdapters && (!status.durableAdapters.reviewReader || !status.durableAdapters.commandService || !status.durableAdapters.applyRepository)) {
    errors.push("durable review/apply adapters are unavailable");
  }
  const streams = new Map(status.streams.map((stream) => [stream.streamType, stream]));
  for (const root of REQUIRED_ROOTS) {
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
    checkCounters(root, stream, errors);
  }
  for (const stream of status.streams) {
    if (!(REQUIRED_ROOTS as readonly string[]).includes(stream.streamType) && stream.state === "failed") {
      errors.push(`optional stream ${stream.streamType} failed`);
    }
  }
  checkCounters("all-stream", status.allStreams, errors);
  const contact = streams.get("contact");
  if (!contact || contact.observedIdentities <= 0) errors.push("contact count is zero");

  for (const audit of audits) {
    if (audit.method !== "GET") errors.push("audit contains a non-GET method");
    if (audit.state !== "succeeded") errors.push("audit contains an unsuccessful request");
    if (audit.httpStatus !== null && (audit.httpStatus < 200 || audit.httpStatus >= 300)) {
      errors.push("audit contains a non-success HTTP status");
    }
    if (!audit.pathTemplate.startsWith("/")) errors.push("audit contains an invalid path");
    if (/password|secret|token|authorization|cookie|body|raw/i.test(audit.pathTemplate)) errors.push("audit contains a sensitive path");
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
  if (!response.ok) throw new Error(`preview endpoint returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchAndVerifyPreview(input: {
  baseUrl: string;
  runId?: string;
  ownerToken?: string;
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
    endpoint(input.baseUrl, `/migration/act-replacement/runs/${encodeURIComponent(runId)}`),
    input.ownerToken,
  );
  const audits = await getJson<{ audits: PreviewAudit[] }>(
    endpoint(input.baseUrl, `/migration/act-replacement/runs/${encodeURIComponent(runId)}/request-audit`),
    input.ownerToken,
  );
  return verifyActReplacementPreview(result.run, audits.audits);
}

async function main() {
  const verification = await fetchAndVerifyPreview({
    baseUrl: process.env.ACT_PREVIEW_BASE_URL ?? "http://localhost:10000/api",
    runId: process.env.ACT_PREVIEW_RUN_ID,
    ownerToken: process.env.ACT_PREVIEW_OWNER_TOKEN,
  });
  if (!verification.ok) {
    console.error(`Act preview verification failed (${verification.errors.length} checks):`);
    for (const error of verification.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Act preview verification passed: durable archive is ready for review.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Act preview verification failed");
    process.exitCode = 1;
  });
}
