import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "../../lib/logger";
import {
  applyApprovedProfileReconciliation,
  loadApprovedProfileReconciliation,
} from "./reconciliation";
import { applyBlankProfileBatch01 } from "../organizations/blank-profile-batch-01";
import { applyBlankProfileBatch02 } from "../organizations/blank-profile-batch-02";

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
  matchExisting?: unknown;
  requireExisting?: unknown;
  aliases?: unknown;
  event?: unknown;
  notes?: unknown;
  followUps?: unknown;
  clearFollowUps?: unknown;
};

type ApprovedProfilePayloadEntry = {
  file: string;
  sourceFile: string;
  payload: ApprovedProfilePayload;
};

type ProfileImportResponse = {
  profileId?: unknown;
};

type ProfileSearchResult = {
  id?: unknown;
  kind?: unknown;
  label?: unknown;
  city?: unknown;
  region?: unknown;
};

type ProfileSearchResponse = {
  results?: unknown;
};

class ApprovedProfileMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovedProfileMatchError";
  }
}

function normalized(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function compatibleLocation(
  result: ProfileSearchResult,
  event: Record<string, unknown>,
) {
  const expectedCity = normalized(event.city);
  const expectedRegion = normalized(event.region);
  const resultCity = normalized(result.city);
  const resultRegion = normalized(result.region);
  if (expectedCity && resultCity && expectedCity !== resultCity) return false;
  if (expectedRegion && resultRegion && expectedRegion !== resultRegion) return false;
  return true;
}

function uniqueProfileIds(results: ProfileSearchResult[]) {
  return [...new Set(
    results
      .map((result) => typeof result.id === "string" ? result.id : "")
      .filter(Boolean),
  )];
}

function selectExistingProfile(
  results: ProfileSearchResult[],
  event: Record<string, unknown>,
  names: string[],
  file: string,
) {
  const normalizedNames = [...new Set(names.map(normalized).filter(Boolean))];
  if (normalizedNames.length === 0) return null;

  const organizations = results.filter((result) =>
    result.kind === "organization"
    && typeof result.id === "string"
    && compatibleLocation(result, event),
  );

  const exact = organizations.filter((result) => {
    const label = normalized(result.label);
    return normalizedNames.includes(label);
  });
  const exactIds = uniqueProfileIds(exact);
  if (exactIds.length === 1) return exactIds[0]!;
  if (exactIds.length > 1) {
    throw new ApprovedProfileMatchError(
      `Approved profile import ${file} matched more than one existing profile across canonical name or aliases.`,
    );
  }

  const close = organizations.filter((result) => {
    const label = normalized(result.label);
    if (!label) return false;
    return normalizedNames.some((name) => label.includes(name) || name.includes(label));
  });
  const closeIds = uniqueProfileIds(close);
  if (closeIds.length === 1) return closeIds[0]!;
  if (closeIds.length > 1) {
    throw new ApprovedProfileMatchError(
      `Approved profile import ${file} matched more than one existing profile across canonical name or aliases.`,
    );
  }
  return null;
}

function readPayloadObject(value: unknown, file: string): ApprovedProfilePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Approved profile import ${file} must contain a profile object.`);
  }
  return value as ApprovedProfilePayload;
}

function expandApprovedProfilePayloads(
  parsed: unknown,
  sourceFile: string,
): ApprovedProfilePayloadEntry[] {
  if (!Array.isArray(parsed)) {
    return [{
      file: sourceFile,
      sourceFile,
      payload: readPayloadObject(parsed, sourceFile),
    }];
  }
  if (parsed.length === 0) {
    throw new Error(`Approved profile import ${sourceFile} contains an empty batch.`);
  }
  return parsed.map((value, index) => {
    const file = `${sourceFile}#${index + 1}`;
    return {
      file,
      sourceFile,
      payload: readPayloadObject(value, file),
    };
  });
}

function readAliases(payload: ApprovedProfilePayload, file: string): string[] {
  if (payload.aliases == null) return [];
  if (!Array.isArray(payload.aliases)) {
    throw new Error(`Approved profile import ${file} has invalid aliases.`);
  }
  const aliases = payload.aliases.map((value, index) => {
    const alias = typeof value === "string" ? value.trim() : "";
    if (!alias) {
      throw new Error(`Approved profile import ${file} alias ${index + 1} is invalid.`);
    }
    return alias;
  });
  return [...new Set(aliases)];
}

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

async function requestAssistantJson(input: {
  port: number;
  token: string;
  method: "GET" | "POST";
  path: string;
  payload?: unknown;
  failureLabel: string;
}) {
  const response = await fetch(
    `http://127.0.0.1:${input.port}/api/assistant-import/${input.path}`,
    {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.token}`,
        ...(input.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(input.method === "POST" ? { body: JSON.stringify(input.payload) } : {}),
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

async function searchProfiles(input: {
  port: number;
  token: string;
  query: string;
  file: string;
}) {
  const responseBody = await requestAssistantJson({
    port: input.port,
    token: input.token,
    method: "GET",
    path: `profile-search?q=${encodeURIComponent(input.query)}&limit=20`,
    failureLabel: `Approved profile match search failed for ${input.file}`,
  });

  let search: ProfileSearchResponse;
  try {
    search = JSON.parse(responseBody) as ProfileSearchResponse;
  } catch {
    throw new Error(`Approved profile match search ${input.file} returned invalid JSON.`);
  }
  return Array.isArray(search.results) ? search.results as ProfileSearchResult[] : [];
}

async function resolveExistingProfile(input: {
  port: number;
  token: string;
  payload: ApprovedProfilePayload;
  file: string;
}) {
  const requireExisting = input.payload.requireExisting === true;
  if (requireExisting && input.payload.matchExisting !== true) {
    throw new ApprovedProfileMatchError(
      `Approved profile import ${input.file} requires matchExisting to target an existing profile.`,
    );
  }
  if (input.payload.matchExisting !== true) return input.payload;
  if (!input.payload.event || typeof input.payload.event !== "object") {
    if (requireExisting) {
      throw new ApprovedProfileMatchError(
        `Approved profile import ${input.file} requires valid event details for matching.`,
      );
    }
    return input.payload;
  }

  const event = input.payload.event as Record<string, unknown>;
  if (typeof event.id === "string" && event.id.trim()) {
    if (requireExisting) {
      throw new ApprovedProfileMatchError(
        `Approved profile import ${input.file} cannot preselect an event id when safe matching is required.`,
      );
    }
    return input.payload;
  }
  const name = typeof event.name === "string" ? event.name.trim() : "";
  if (!name) {
    if (requireExisting) {
      throw new ApprovedProfileMatchError(
        `Approved profile import ${input.file} requires an event name for matching.`,
      );
    }
    return input.payload;
  }

  const aliases = readAliases(input.payload, input.file);
  const names = [...new Set([name, ...aliases])];
  const byId = new Map<string, ProfileSearchResult>();
  const withoutId: ProfileSearchResult[] = [];

  for (const query of names) {
    const results = await searchProfiles({
      port: input.port,
      token: input.token,
      query,
      file: input.file,
    });
    for (const result of results) {
      if (typeof result.id === "string" && result.id) byId.set(result.id, result);
      else withoutId.push(result);
    }
  }

  const profileId = selectExistingProfile(
    [...byId.values(), ...withoutId],
    event,
    names,
    input.file,
  );
  if (!profileId && input.payload.requireExisting === true) {
    throw new ApprovedProfileMatchError(
      `Approved profile import ${input.file} requires one existing profile match.`,
    );
  }
  if (!profileId) return input.payload;

  return {
    ...input.payload,
    event: { ...event, id: profileId },
  };
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

  try {
    const batch01 = await applyBlankProfileBatch01();
    logger.info(
      batch01,
      "Blank profile research batch 01 maintenance applied or safely skipped",
    );
  } catch (error) {
    logger.error(
      { err: error },
      "Blank profile research batch 01 maintenance failed; approved profile imports will continue",
    );
  }

  try {
  const batch02 = await applyBlankProfileBatch02();
  logger.info(
    batch02,
    "Blank profile research batch 02 maintenance applied or safely skipped",
  );
} catch (error) {
  logger.error(
    { err: error },
    "Blank profile research batch 02 maintenance failed; approved profile imports will continue",
  );
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
  const rawPayloads = await Promise.all(files.map(async (file) => ({
    file,
    raw: await readFile(path.join(directory, file), "utf8"),
  })));
  const payloadEntries = rawPayloads.flatMap(({ file, raw }) =>
    expandApprovedProfilePayloads(JSON.parse(raw) as unknown, file),
  );
  const reconciliation = await loadApprovedProfileReconciliation();

  let imported = 0;
  let skipped = 0;

  for (const entry of payloadEntries) {
    const { file, sourceFile } = entry;
    const originalPayload = applyApprovedProfileReconciliation(
      entry.payload,
      reconciliation,
      sourceFile,
    );
    const notes = readApprovedNotes(originalPayload, file);
    const followUps = readApprovedFollowUps(originalPayload, file);
    const clearFollowUps = originalPayload.clearFollowUps === true;

    let payload: ApprovedProfilePayload;
    try {
      payload = await resolveExistingProfile({
        port,
        token,
        payload: originalPayload,
        file,
      });
    } catch (error) {
      if (error instanceof ApprovedProfileMatchError) {
        skipped += 1;
        logger.warn(
          { file, sourceFile, reason: error.message },
          "Approved profile import skipped because profile matching did not produce one safe target",
        );
        continue;
      }
      throw error;
    }

    const responseBody = await requestAssistantJson({
      port,
      token,
      method: "POST",
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
    if ((notes.length > 0 || followUps.length > 0 || clearFollowUps) && !profileId) {
      throw new Error(`Approved profile import ${file} did not return a profileId.`);
    }

    for (const note of notes) {
      await requestAssistantJson({
        port,
        token,
        method: "POST",
        path: "profile-notes",
        payload: { organizationId: profileId, ...note },
        failureLabel: `Approved profile note import failed for ${file}`,
      });
    }

    if (clearFollowUps && followUps.length === 0) {
      await requestAssistantJson({
        port,
        token,
        method: "POST",
        path: "today-followups/clear",
        payload: {
          organizationId: profileId,
          reason: "Cleared by 2026-08-28 deep-research reconciliation: no future action is currently justified.",
        },
        failureLabel: `Approved profile follow-up clear failed for ${file}`,
      });
    }

    for (const followUp of followUps) {
      await requestAssistantJson({
        port,
        token,
        method: "POST",
        path: "today-followups",
        payload: { organizationId: profileId, ...followUp, preserveExisting: true },
        failureLabel: `Approved profile follow-up import failed for ${file}`,
      });
    }

    imported += 1;
    logger.info({ file, sourceFile }, "Approved profile imported at startup");
  }

  return { imported, skipped, files };
}
