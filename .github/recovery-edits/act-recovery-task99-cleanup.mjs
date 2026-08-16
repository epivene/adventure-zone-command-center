import { rm } from "node:fs/promises";

const temporaryPaths = [
  ".github/patches/act-recovery-task01.patch",
  ".github/recovery-edits/act-recovery-task01.mjs",
  ".github/recovery-edits/act-recovery-task07.mjs",
  ".github/recovery-edits/act-recovery-task08.mjs",
  ".github/recovery-edits/act-recovery-task09.mjs",
  ".github/recovery-edits/act-recovery-task99-cleanup.mjs",
  ".github/workflows/act-recovery-apply.yml",
  ".github/workflows/act-recovery-tdd.yml",
  "lib/db/.act-recovery-ci-pulse",
];

for (const path of temporaryPaths) {
  await rm(path, { force: true });
  console.log(`Removed temporary recovery helper: ${path}`);
}
