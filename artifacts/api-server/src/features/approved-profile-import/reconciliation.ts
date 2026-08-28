import { readFile } from "node:fs/promises";
import path from "node:path";

type ApprovedProfilePayload = Record<string, unknown> & {
  aliases?: unknown;
  event?: unknown;
  profile?: unknown;
  contacts?: unknown;
  booking?: unknown;
  notes?: unknown;
  followUps?: unknown;
  clearFollowUps?: unknown;
};

type ReconciliationRecord = {
  canonicalName: string;
  aliases?: string[];
  event?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  contacts?: unknown[];
  booking?: Record<string, unknown>;
  notes?: unknown[];
  followUps?: unknown[];
  clearFollowUps?: boolean;
};

function normalized(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(
    values
      .map((value) => typeof value === "string" ? value.trim() : "")
      .filter(Boolean),
  )];
}

export async function loadApprovedProfileReconciliation(): Promise<ReconciliationRecord[]> {
  const file = path.resolve(process.cwd(), "imports", "approved-profile-reconciliation-2026-08-28.json");
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Reconciliation file must contain an array.");
    return parsed as ReconciliationRecord[];
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT") return [];
    throw error;
  }
}

export function applyApprovedProfileReconciliation(
  payload: ApprovedProfilePayload,
  records: ReconciliationRecord[],
  file: string,
): ApprovedProfilePayload {
  if (!payload.event || typeof payload.event !== "object") return payload;
  const event = payload.event as Record<string, unknown>;
  const eventName = normalized(event.name);
  if (!eventName) return payload;

  const matches = records.filter((record) => {
    const names = [record.canonicalName, ...(record.aliases ?? [])].map(normalized);
    return names.includes(eventName);
  });
  if (matches.length === 0) return payload;
  if (matches.length > 1) {
    throw new Error(`Approved profile import ${file} matched more than one reconciliation record.`);
  }

  const record = matches[0]!;
  const aliases = uniqueStrings([
    ...(Array.isArray(payload.aliases) ? payload.aliases : []),
    ...(record.aliases ?? []),
    record.canonicalName,
  ]).filter((alias) => normalized(alias) !== eventName);

  const next: ApprovedProfilePayload = {
    ...payload,
    aliases,
    event: { ...event, ...(record.event ?? {}) },
  };

  if (record.profile) next.profile = { ...asObject(payload.profile), ...record.profile };
  if (record.contacts) next.contacts = record.contacts;
  if (record.booking) next.booking = { ...asObject(payload.booking), ...record.booking };
  if (record.notes) next.notes = record.notes;
  if (record.followUps) next.followUps = record.followUps;
  if (typeof record.clearFollowUps === "boolean") next.clearFollowUps = record.clearFollowUps;

  return next;
}
