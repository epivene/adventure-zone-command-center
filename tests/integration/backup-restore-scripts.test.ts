import {
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
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const backupScript = path.join(projectRoot, "scripts/backup-database.sh");
const restoreScript = path.join(projectRoot, "scripts/restore-database.sh");
const temporaryRoots: string[] = [];

async function executable(filePath: string, source: string) {
  await writeFile(filePath, source, { mode: 0o700 });
  await chmod(filePath, 0o700);
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

  return {
    root,
    binaryDirectory,
    backupDirectory,
    temporaryDirectory,
    commandLog,
    env: {
      ...process.env,
      PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
      TMPDIR: temporaryDirectory,
      COMMAND_LOG: commandLog,
      DATABASE_URL: "postgresql://backup-user@example.test/adventure_zone",
      BACKUP_ENCRYPTION_PASSPHRASE: "correct horse battery staple",
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
      /^adventure-zone-\d{8}T\d{6}Z\.dump\.gpg$/,
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
