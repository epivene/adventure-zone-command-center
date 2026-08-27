import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "../../lib/logger";

type StartupImportResult = {
  imported: number;
  skipped: number;
  files: string[];
};

type ApprovedProfileNote = {
  subject: string;
  body: string;
};

type ApprovedProfileFollowUp = {
  label: string;
  reason: string;
  dueAt: string;
};

type ApprovedProfilePayload = Record<string, unknown> & {
  notes?: unknown;
  followUps?: unknown;
};

type ProfileImportResponse = {
  profileId?: unknown;
};

function readApprovedNotes(payload: ApprovedProfilePayload, file: string): ApprovedProfileNote[] {
  if (payload.notes == null) return [];
  if (!Array.isArray(payload.notes)) {
    throw new Error(`Approved profile import ${file} has invalid notes.`);
  }
  return payload.notes.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`Approved profile import ${file} note ${index + 1} is invalid.`);
    }
    const note = value as Record<string, unknown>;
    const subject = typeof note.subject === "string" ? note.subject.trim() : "";
    const body = typeof note.body === "string" ? note.body.trim() : "";
    if (!subject || !body) {
      throw new Error(`Approved profile import ${file} note ${index + 1} is incomplete.`);
    }
    return { subject, body };
  });
}

function readApprovedFollowUps(payload: ApprovedProfilePayload, file: string): ApprovedProfileFollowUp[] {
  if (payload.followUps == null) return [];
  if (!Array.isArray(payload.followUps)) {
    throw new Error(`Approved profile import ${file} has invalid followUps.`);
  }
  return payload.followUps.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`Approved profile import ${file} follow-up ${index + 1} is invalid.`);
    }
    const followUp = value as Record<string, unknown>;
    const label = typeof followUp.label === "string" ? followUp.label.trim() : "";
    const reason = typeof followUp.reason === "string" ? followUp.reason.trim() : "";
    const dueAt = typeof followUp.dueAt === "string" ? followUp.dueAt.trim() : "";
    if (!label || !reason || !dueAt || Number.isNaN(new Date(dueAt).getTime())) {
      throw new Error(`Approved profile import ${file} follow-up ${index + 1} is incomplete.`);
    }
    return { label, reason, dueAt };
  });
}

async function postAssistantJson(input: {
  port: number;
  token: string;
  path: string;
  payload: unknown;
  failureLabel: string;
}) {
  const response = await fetch(
    `http://127.0.0.1:${input.port}/api/assistant-import/${input.path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.payload),
    },
  );
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `${input.failureLabel}: HTTP ${response.status} ${responseBody.slice(0, 500)}`,
    );
  }
  return responseBody;
}

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
    const payload = JSON.parse(raw) as ApprovedProfilePayload;
    const notes = readApprovedNotes(payload, file);
    const followUps = readApprovedFollowUps(payload, file);

    const responseBody = await postAssistantJson({
      port,
      token,
      path: "event-profiles",
      payload,
      failureLabel: `Approved profile import failed for ${file}`,
    });

    let result: ProfileImportResponse;
    try {
      result = JSON.parse(responseBody) as ProfileImportResponse;
    } catch {
      throw new Error(`Approved profile import ${file} returned invalid JSON.`);
    }
    const profileId = typeof result.profileId === "string" ? result.profileId.trim() : "";
    if ((notes.length > 0 || followUps.length > 0) && !profileId) {
      throw new Error(`Approved profile import ${file} did not return a profileId.`);
    }

    for (const note of notes) {
      await postAssistantJson({
        port,
        token,
        path: "profile-notes",
        payload: { organizationId: profileId, ...note },
        failureLabel: `Approved profile note import failed for ${file}`,
      });
    }

    for (const followUp of followUps) {
      await postAssistantJson({
        port,
        token,
        path: "today-followups",
        payload: { organizationId: profileId, ...followUp },
        failureLabel: `Approved profile follow-up import failed for ${file}`,
      });
    }

    imported += 1;
    logger.info({ file }, "Approved profile imported at startup");
  }

  return { imported, skipped: 0, files };
}
