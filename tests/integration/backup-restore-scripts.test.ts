import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const backupScript = path.join(projectRoot, "scripts/backup-database.sh");
const restoreScript = path.join(projectRoot, "scripts/restore-database.sh");
const migrationPreflightScript = path.join(
  projectRoot,
  "scripts/preflight-stage-one-migration.sh",
);
const temporaryRoots: string[] = [];

function environmentWithFixturePath(binaryDirectory: string): NodeJS.ProcessEnv {
  const existingPath = Object.entries(process.env).find(
    ([key]) => key.toLowerCase() === "path",
  )?.[1];
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  );

  return {
    ...environment,
    NODE_ENV: process.env.NODE_ENV,
    PATH: `${binaryDirectory}${path.delimiter}${existingPath ?? ""}`,
  };
}

async function executable(filePath: string, source: string) {
  await writeFile(filePath, source, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

function runScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [script, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function waitForFile(filePath: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "adventure-zone-operations-"));
  temporaryRoots.push(root);
  const binaryDirectory = path.join(root, "bin");
  const backupDirectory = path.join(root, "backups");
  const temporaryDirectory = path.join(root, "tmp");
  const commandLog = path.join(root, "command-log");
  await Promise.all([
    mkdir(binaryDirectory),
    mkdir(backupDirectory),
    mkdir(temporaryDirectory),
    mkdir(commandLog),
  ]);

  await executable(
    path.join(binaryDirectory, "pg_dump"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "$COMMAND_LOG/pg_dump.args"
[[ "$1" == "--format=custom" ]]
[[ "$2" == "--file" ]]
printf 'custom dump' > "$3"
`,
  );
  await executable(
    path.join(binaryDirectory, "gpg"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "$COMMAND_LOG/gpg.args"
output=
previous=
for argument in "$@"; do
  if [[ "$previous" == "--output" ]]; then output="$argument"; fi
  previous="$argument"
done
input="\${@: -1}"
cp -- "$input" "$output"
`,
  );
  await executable(
    path.join(binaryDirectory, "pg_restore"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > "$COMMAND_LOG/pg_restore.args"
`,
  );
  await executable(
    path.join(binaryDirectory, "psql"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$COMMAND_LOG/psql.calls"
if [[ "$*" == *"act_external_links"* ]]; then
  printf '%s\\n' "\${ACT_DUPLICATE_GROUPS:-0}"
elif [[ "$*" == *"travel_legs"* ]]; then
  printf '%s\\n' "\${INVALID_TRAVEL_LEGS:-0}"
else
  printf 'Unexpected preflight query.\\n' >&2
  exit 71
fi
`,
  );
  await executable(
    path.join(binaryDirectory, "date"),
    "#!/usr/bin/env bash\nprintf '20260725T120000Z\\n'\n",
  );

  return {
    root,
    binaryDirectory,
    backupDirectory,
    temporaryDirectory,
    commandLog,
    env: {
      ...environmentWithFixturePath(binaryDirectory),
      TMPDIR: temporaryDirectory,
      COMMAND_LOG: commandLog,
      DATABASE_URL: "postgresql://backup-user@example.test/adventure_zone",
      BACKUP_ENCRYPTION_PASSPHRASE: "correct horse battery staple",
      CONFIRM_DISPOSABLE_DATABASE_RESTORE:
        "I_CONFIRM_THIS_DATABASE_IS_DISPOSABLE",
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("database backup command", () => {
  it("keeps a successful same-second backup when another invocation fails", async () => {
    const context = await fixture();
    await executable(
      path.join(context.binaryDirectory, "gpg"),
      `#!/usr/bin/env bash
set -euo pipefail
output=
previous=
for argument in "$@"; do
  if [[ "$previous" == "--output" ]]; then output="$argument"; fi
  previous="$argument"
done
input="\${@: -1}"
if [[ "\${GPG_MODE:-success}" == "fail-after-success" ]]; then
  printf '%s\\n' "$output" > "$COMMAND_LOG/failing-output"
  : > "$COMMAND_LOG/failing-ready"
  for _ in {1..500}; do
    [[ -f "$COMMAND_LOG/success-done" ]] && exit 27
    sleep 0.01
  done
  exit 28
fi
cp -- "$input" "$output"
printf '%s\\n' "$output" > "$COMMAND_LOG/success-output"
: > "$COMMAND_LOG/success-done"
`,
    );

    const failing = runScript(
      backupScript,
      [context.backupDirectory],
      { ...context.env, GPG_MODE: "fail-after-success" },
    );
    await waitForFile(path.join(context.commandLog, "failing-ready"));
    const successful = runScript(
      backupScript,
      [context.backupDirectory],
      context.env,
    );

    const [failure, success] = await Promise.all([failing, successful]);

    expect(failure.status).not.toBe(0);
    expect(success.status, success.stderr).toBe(0);
    const files = await readdir(context.backupDirectory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(
      /^adventure-zone-20260725T120000Z\.[A-Za-z0-9]+\.dump\.gpg$/,
    );
    expect(
      await readFile(path.join(context.backupDirectory, files[0]!), "utf8"),
    ).toBe("custom dump");
    const [failingOutput, successfulOutput] = await Promise.all([
      readFile(path.join(context.commandLog, "failing-output"), "utf8"),
      readFile(path.join(context.commandLog, "success-output"), "utf8"),
    ]);
    expect(failingOutput.trim()).not.toBe(successfulOutput.trim());
  });

  it("creates a UTC-named encrypted custom dump and removes plaintext", async () => {
    const context = await fixture();

    const result = spawnSync("bash", [backupScript, context.backupDirectory], {
      env: context.env,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const files = await readdir(context.backupDirectory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(
      /^adventure-zone-\d{8}T\d{6}Z\.[A-Za-z0-9]+\.dump\.gpg$/,
    );
    expect(
      await readFile(path.join(context.backupDirectory, files[0]!), "utf8"),
    ).toBe("custom dump");
    expect(await readdir(context.temporaryDirectory)).toEqual([]);
    expect(
      (await readFile(path.join(context.commandLog, "pg_dump.args"), "utf8"))
        .trim()
        .split("\n"),
    ).toEqual([
      "--format=custom",
      "--file",
      expect.stringMatching(/adventure-zone-backup\..+\.dump$/),
      context.env.DATABASE_URL,
    ]);
    const gpgArguments = (
      await readFile(path.join(context.commandLog, "gpg.args"), "utf8")
    )
      .trim()
      .split("\n");
    expect(gpgArguments).toEqual([
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--passphrase",
      context.env.BACKUP_ENCRYPTION_PASSPHRASE,
      "--symmetric",
      "--cipher-algo",
      "AES256",
      "--output",
      path.join(context.backupDirectory, files[0]!),
      expect.stringMatching(/adventure-zone-backup\..+\.dump$/),
    ]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      context.env.BACKUP_ENCRYPTION_PASSPHRASE,
    );
  });

  it("fails closed and removes temporary output when encryption fails", async () => {
    const context = await fixture();
    await executable(
      path.join(context.binaryDirectory, "gpg"),
      "#!/usr/bin/env bash\nexit 27\n",
    );

    const result = spawnSync("bash", [backupScript, context.backupDirectory], {
      env: context.env,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(await readdir(context.backupDirectory)).toEqual([]);
    expect(await readdir(context.temporaryDirectory)).toEqual([]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      context.env.BACKUP_ENCRYPTION_PASSPHRASE,
    );
  });
});

describe("database restore command", () => {
  it("refuses before decryption when disposable confirmation is absent or wrong", async () => {
    const context = await fixture();
    const backupPath = path.join(
      context.backupDirectory,
      "adventure-zone-20260725T120000Z.dump.gpg",
    );
    await writeFile(backupPath, "encrypted custom dump");
    const absentConfirmation: NodeJS.ProcessEnv = { ...context.env };
    delete absentConfirmation.CONFIRM_DISPOSABLE_DATABASE_RESTORE;

    const absent = spawnSync("bash", [restoreScript, backupPath], {
      env: absentConfirmation,
      encoding: "utf8",
    });
    const wrong = spawnSync("bash", [restoreScript, backupPath], {
      env: {
        ...context.env,
        CONFIRM_DISPOSABLE_DATABASE_RESTORE: "yes",
      },
      encoding: "utf8",
    });

    expect(absent.status).not.toBe(0);
    expect(wrong.status).not.toBe(0);
    expect(`${absent.stdout}${absent.stderr}`).toContain(
      "I_CONFIRM_THIS_DATABASE_IS_DISPOSABLE",
    );
    expect(`${wrong.stdout}${wrong.stderr}`).toContain(
      "I_CONFIRM_THIS_DATABASE_IS_DISPOSABLE",
    );
    await expect(
      readFile(path.join(context.commandLog, "gpg.args"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(context.commandLog, "pg_restore.args"), "utf8"),
    ).rejects.toThrow();
  });

  it("decrypts an explicit file, restores it, and removes plaintext", async () => {
    const context = await fixture();
    const backupPath = path.join(
      context.backupDirectory,
      "adventure-zone-20260725T120000Z.dump.gpg",
    );
    await writeFile(backupPath, "encrypted custom dump");

    const result = spawnSync("bash", [restoreScript, backupPath], {
      env: context.env,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(await readdir(context.temporaryDirectory)).toEqual([]);
    expect(
      (await readFile(path.join(context.commandLog, "pg_restore.args"), "utf8"))
        .trim()
        .split("\n"),
    ).toEqual([
      "--clean",
      "--if-exists",
      "--dbname",
      context.env.DATABASE_URL,
      expect.stringMatching(/adventure-zone-restore\..+\.dump$/),
    ]);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      context.env.BACKUP_ENCRYPTION_PASSPHRASE,
    );
  });

  it("refuses a missing path and a directory before decrypting", async () => {
    const context = await fixture();

    const missing = spawnSync("bash", [restoreScript], {
      env: context.env,
      encoding: "utf8",
    });
    const directory = spawnSync("bash", [restoreScript, context.backupDirectory], {
      env: context.env,
      encoding: "utf8",
    });

    expect(missing.status).not.toBe(0);
    expect(directory.status).not.toBe(0);
    await expect(
      readFile(path.join(context.commandLog, "gpg.args"), "utf8"),
    ).rejects.toThrow();
  });
});

describe("Stage 1 migration preflight command", () => {
  it("passes only after checking both validating migration constraints", async () => {
    const context = await fixture();

    const result = spawnSync("bash", [migrationPreflightScript], {
      env: context.env,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Migration preflight passed");
    const calls = await readFile(
      path.join(context.commandLog, "psql.calls"),
      "utf8",
    );
    expect(calls).toContain("act_external_links");
    expect(calls).toContain("GROUP BY entity_type, act_record_id");
    expect(calls).toContain("HAVING count(*) > 1");
    expect(calls).toContain("travel_legs");
    expect(calls).toContain("sort_order NOT BETWEEN 1 AND 4");
  });

  it("fails closed when duplicate Act identifiers would block the unique index", async () => {
    const context = await fixture();

    const result = spawnSync("bash", [migrationPreflightScript], {
      env: { ...context.env, ACT_DUPLICATE_GROUPS: "2" },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "2 duplicate Act external-identifier group(s)",
    );
    expect(result.stderr).toContain("Do not delete or merge these rows automatically");
    expect(result.stderr).toContain("GROUP BY entity_type, act_record_id");
  });

  it("fails closed when travel-leg sort orders would block the check constraint", async () => {
    const context = await fixture();

    const result = spawnSync("bash", [migrationPreflightScript], {
      env: { ...context.env, INVALID_TRAVEL_LEGS: "1" },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "1 travel-leg row(s) with sort_order outside 1-4",
    );
    expect(result.stderr).toContain("Do not rewrite or delete these rows automatically");
    expect(result.stderr).toContain("sort_order NOT BETWEEN 1 AND 4");
  });
});
