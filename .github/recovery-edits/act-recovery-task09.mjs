import { readFile, writeFile } from "node:fs/promises";

const path = "artifacts/api-server/src/features/act-recovery/timeline-recovery.ts";
const before = await readFile(path, "utf8");
const oldText = `      if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "42P01") {\n        return null;\n      }\n      throw error;`;
const newText = `      const directCode = error && typeof error === "object" && "code" in error\n        ? String((error as { code?: unknown }).code ?? "")\n        : "";\n      const cause = error && typeof error === "object" && "cause" in error\n        ? (error as { cause?: unknown }).cause\n        : null;\n      const causeCode = cause && typeof cause === "object" && "code" in cause\n        ? String((cause as { code?: unknown }).code ?? "")\n        : "";\n      if (directCode === "42P01" || causeCode === "42P01") return null;\n      throw error;`;
if (!before.includes(oldText)) {
  if (before.includes(newText)) process.exit(0);
  throw new Error("Missing nested-cause compatibility guard target");
}
await writeFile(path, before.replace(oldText, newText));
