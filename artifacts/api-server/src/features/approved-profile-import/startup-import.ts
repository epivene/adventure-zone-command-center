import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "../../lib/logger";

type StartupImportResult = {
  imported: number;
  skipped: number;
  files: string[];
};

export async function importApprovedProfilesAtStartup(
  port: number,
): Promise<StartupImportResult> {
  const token = process.env["ASSISTANT_IMPORT_TOKEN"]?.trim();
  if (!token) {
    logger.warn(
      "ASSISTANT_IMPORT_TOKEN is not configured; approved profile startup import skipped",
    );
    return { imported: 0, skipped: 1, files: [] };
  }

  const directory = path.resolve(process.cwd(), "imports", "approved-profiles");
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") {
      logger.info("No approved profile import directory found; startup import skipped");
      return { imported: 0, skipped: 1, files: [] };
    }
    throw error;
  }

  const files = entries.filter((entry) => entry.endsWith(".json")).sort();
  let imported = 0;

  for (const file of files) {
    const fullPath = path.join(directory, file);
    const raw = await readFile(fullPath, "utf8");
    const payload = JSON.parse(raw) as unknown;

    const response = await fetch(
      `http://127.0.0.1:${port}/api/assistant-import/event-profiles`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `Approved profile import failed for ${file}: HTTP ${response.status} ${responseBody.slice(0, 500)}`,
      );
    }

    imported += 1;
    logger.info({ file }, "Approved profile imported at startup");
  }

  return { imported, skipped: 0, files };
}
