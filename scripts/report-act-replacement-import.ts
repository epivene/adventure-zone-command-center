#!/usr/bin/env tsx

/**
 * Metadata-only production handoff report for the one-time Act! import.
 *
 * The report consumes only aggregate workflow and gate evidence. It never
 * requests or serializes source snapshots, review display values, request
 * bodies, credentials, cookies, or authorization values.
 */

import {
  verifyActReplacementPreview,
  type PreviewStatus,
} from "./verify-act-replacement-preview";

type ReportStatus = PreviewStatus & {
  safeOperationCount: number;
  reviewRequiredCount: number;
  appliedOperationCount: number;
  alreadyPresentOperationCount: number;
  blockedOperationCount: number;
  failedOperationCount: number;
  manifestDigest: string | null;
};

export type ActReplacementReportInput = {
  status: ReportStatus;
};

export class ReportValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Act replacement report validation failed: ${errors.join("; ")}`);
    this.name = "ReportValidationError";
  }
}

const headers = [
  "run_id",
  "phase",
  "manifest_digest",
  "safe_operations",
  "review_required",
  "applied",
  "already_present",
  "blocked",
  "failed",
  "remaining",
  "apply_batch_count",
  "last_batch_state",
] as const;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function csv(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function reportActReplacementImport(input: ActReplacementReportInput): {
  csv: string;
  runId: string;
  manifestDigest: string;
} {
  const { status } = input;
  const errors = verifyActReplacementPreview(status, [], "post_apply").errors;
  const manifestDigest = status.manifestDigest;
  if (!manifestDigest?.trim()) errors.push("manifest digest is unavailable");
  const counts = [
    status.safeOperationCount,
    status.reviewRequiredCount,
    status.appliedOperationCount,
    status.alreadyPresentOperationCount,
    status.blockedOperationCount,
    status.failedOperationCount,
  ];
  if (!counts.every(isCount)) errors.push("workflow counts are unavailable");
  if (status.blockedOperationCount > 0)
    errors.push("blocked operations remain");
  if (status.failedOperationCount > 0) errors.push("failed operations remain");
  if (
    (status.applyBatches ?? []).some(
      (batch) =>
        !["complete", "complete_with_issues"].includes(batch.state ?? ""),
    )
  ) {
    errors.push("apply batch is not terminal");
  }
  if (errors.length) throw new ReportValidationError([...new Set(errors)]);
  if (!manifestDigest)
    throw new ReportValidationError(["manifest digest is unavailable"]);

  const batches = status.applyBatches ?? [];
  const row = [
    status.runId,
    status.phase,
    manifestDigest,
    status.safeOperationCount,
    status.reviewRequiredCount,
    status.appliedOperationCount,
    status.alreadyPresentOperationCount,
    status.blockedOperationCount,
    status.failedOperationCount,
    status.safeOperationCount + status.reviewRequiredCount,
    batches.length,
    batches.at(-1)?.state ?? "none",
  ];
  return {
    csv: `${headers.join(",")}\n${row.map(csv).join(",")}\n`,
    runId: status.runId,
    manifestDigest,
  };
}

function endpoint(base: string, path: string) {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`report endpoint returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function main() {
  const baseUrl =
    process.env.ACT_PREVIEW_BASE_URL ?? "http://localhost:10000/api";
  const token = process.env.ACT_PREVIEW_OWNER_TOKEN;
  const requestedRunId = process.env.ACT_PREVIEW_RUN_ID;
  const status = requestedRunId
    ? await getJson<{ run: ReportStatus }>(
        endpoint(
          baseUrl,
          `/migration/act-replacement/runs/${encodeURIComponent(requestedRunId)}`,
        ),
        token,
      ).then((body) => body.run)
    : await getJson<{ run: ReportStatus | null }>(
        endpoint(baseUrl, "/migration/act-replacement/runs/latest"),
        token,
      ).then((body) => body.run);
  if (!status) throw new Error("no durable Act replacement run found");
  process.stdout.write(reportActReplacementImport({ status }).csv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Act replacement report failed",
    );
    process.exitCode = 1;
  });
}
