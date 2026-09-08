#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";

type Report = {
  runId: string; sourceKind: string; mode: string; status: string; discovered: number; imported: number;
  deduplicated: number; review: number; skipped: number; retry: number; failed: number; linked: number;
  unaccounted: number; reconciled: boolean; errorCodes: string[];
};

export function parseReportArgs(argv: string[]) {
  const equals = argv.find((argument) => argument.startsWith("--run-id="))?.slice("--run-id=".length);
  const index = argv.indexOf("--run-id");
  const runId = equals || (index >= 0 ? argv[index + 1] : undefined);
  if (!runId) throw new Error("--run-id is required");
  return { runId, jsonOnly: argv.includes("--json") };
}

export function formatBusinessDocumentReport(report: Report, jsonOnly = false) {
  const json = JSON.stringify(report, null, 2);
  if (jsonOnly) return `${json}\n`;
  const rows = [
    ["discovered", report.discovered], ["imported", report.imported], ["deduplicated", report.deduplicated],
    ["review", report.review], ["skipped", report.skipped], ["retry", report.retry], ["failed", report.failed],
    ["linked", report.linked], ["unaccounted", report.unaccounted],
  ];
  const table = ["outcome       count", "-------------------", ...rows.map(([label, value]) => `${String(label).padEnd(13)} ${value}`)].join("\n");
  return `${json}\n\n${table}\n`;
}

export const businessDocumentReportExitCode = (report: Pick<Report, "reconciled">) => report.reconciled ? 0 : 1;

export async function runBusinessDocumentReportCli(argv = process.argv.slice(2), output = (value: string) => process.stdout.write(value)) {
  const args = parseReportArgs(argv);
  const { buildBusinessDocumentReconciliation } = await import("../artifacts/api-server/src/features/business-documents/business-document-reconciliation");
  const report = await buildBusinessDocumentReconciliation(args.runId);
  output(formatBusinessDocumentReport(report, args.jsonOnly));
  return businessDocumentReportExitCode(report);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runBusinessDocumentReportCli().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Business document report failed"); process.exitCode = 1;
  });
}
