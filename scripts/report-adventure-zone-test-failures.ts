import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type AssertionResult = {
  status?: string;
};

type TestResult = {
  name?: string;
  status?: string;
  assertionResults?: AssertionResult[];
};

type VitestReport = {
  numFailedTestSuites?: number;
  numFailedTests?: number;
  testResults?: TestResult[];
};

type Runtime = {
  node: string;
  platform: string;
};

function sourcePath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  const sourceIndex = normalized.lastIndexOf("/src/");
  return sourceIndex >= 0
    ? normalized.slice(sourceIndex + 1)
    : normalized.startsWith("src/")
      ? normalized
      : path.posix.basename(normalized);
}

function domainFor(file: string) {
  const segments = file.split("/").slice(1);
  if (segments[0] === "pages") return "pages";
  return segments.length >= 3
    ? `${segments[0]}/${segments[1]}`
    : (segments[0] ?? "unknown");
}

export function buildFailureInventory(report: VitestReport, runtime: Runtime) {
  const groups = new Map<
    string,
    { domain: string; failedFiles: number; failedTests: number; files: string[] }
  >();

  for (const result of report.testResults ?? []) {
    const failedAssertions = (result.assertionResults ?? []).filter(
      ({ status }) => status === "failed",
    ).length;
    if (result.status !== "failed" && failedAssertions === 0) continue;

    const file = sourcePath(result.name ?? "unknown");
    const domain = domainFor(file);
    const group = groups.get(domain) ?? {
      domain,
      failedFiles: 0,
      failedTests: 0,
      files: [],
    };
    group.failedFiles += 1;
    group.failedTests += failedAssertions;
    group.files.push(file);
    groups.set(domain, group);
  }

  const sortedGroups = [...groups.values()]
    .map((group) => ({ ...group, files: group.files.sort() }))
    .sort((left, right) => left.domain.localeCompare(right.domain));

  return {
    runtime,
    totals: {
      failedFiles: sortedGroups.reduce(
        (total, group) => total + group.failedFiles,
        0,
      ),
      failedTests: sortedGroups.reduce(
        (total, group) => total + group.failedTests,
        0,
      ),
    },
    groups: sortedGroups,
  };
}

function argumentValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(
    prefix.length,
  );
}

function runCli() {
  const input = argumentValue("input");
  const output = argumentValue("output");
  if (!input || !output) {
    throw new Error("Usage: --input=<path> --output=<path>");
  }

  const report = JSON.parse(readFileSync(input, "utf8")) as VitestReport;
  const inventory = buildFailureInventory(report, {
    node: process.version,
    platform: process.platform,
  });
  writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
