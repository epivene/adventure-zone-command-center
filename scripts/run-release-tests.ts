import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

type ReleaseCommandRunner = (
  executable: string,
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv;
    stdio: "inherit";
  },
) => {
  error?: Error;
  status: number | null;
};

type ReleaseTestRunnerOptions = {
  environment?: NodeJS.ProcessEnv;
  execPath?: string;
  run?: ReleaseCommandRunner;
};

// `test:crm-db` is the authoritative, serial inventory of real PostgreSQL
// suites, including the reviewed-import apply repositories.
export const releaseCommands = [
  ["run", "test:crm-db"],
  ["run", "lint"],
  ["run", "typecheck"],
  ["test"],
  [
    "run",
    "test:e2e",
    "--",
    "tests/e2e/call-workspace.spec.ts",
    "tests/e2e/responsive.spec.ts",
    "tests/e2e/accessibility.spec.ts",
    "tests/e2e/booking-packages-resources.spec.ts",
    "tests/e2e/booking-flow.spec.ts",
  ],
] as const;

export function runReleaseTests({
  environment = process.env,
  execPath = process.execPath,
  run = (executable, args, options) =>
    spawnSync(executable, [...args], options),
}: ReleaseTestRunnerOptions = {}) {
  const npmExecPath = environment.npm_execpath;
  if (!npmExecPath) {
    console.error("npm_execpath is required to run the release test gate.");
    return 1;
  }
  const releaseEnvironment = {
    ...environment,
    CRM_RELEASE_TESTS: "1",
  };

  for (const command of releaseCommands) {
    const result = run(
      execPath,
      [npmExecPath, ...command],
      { env: releaseEnvironment, stdio: "inherit" },
    );
    if (result.error) {
      console.error(result.error);
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }

  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = runReleaseTests();
}
