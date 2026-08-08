import { createHash } from "node:crypto";

const sensitiveSourceKeys = new Set([
  "authorization",
  "access-token",
  "bearer-token",
  "password",
  "token",
]);

export class SourceFingerprintError extends Error {
  readonly code = "INVALID_SOURCE_CONTENT";

  constructor() {
    super("Source content cannot be archived safely.");
    this.name = "SourceFingerprintError";
  }
}

function invalidSourceContent(): never {
  throw new SourceFingerprintError();
}

function isSensitiveSourceKey(key: string) {
  return sensitiveSourceKeys.has(key.toLowerCase().replaceAll("_", "-"));
}

function rejectSparseArray(value: unknown[]) {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      invalidSourceContent();
    }
  }
}

function cloneSanitized(value: unknown, ancestors: Set<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidSourceContent();
    return value;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) invalidSourceContent();
    return new Date(value.getTime());
  }
  if (typeof value !== "object") invalidSourceContent();
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    invalidSourceContent();
  }
  if (Object.getOwnPropertySymbols(value).length > 0) invalidSourceContent();
  if (Array.isArray(value)) rejectSparseArray(value);
  if (ancestors.has(value)) invalidSourceContent();

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => cloneSanitized(item, ancestors));
    }
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (isSensitiveSourceKey(key)) continue;
      Object.defineProperty(sanitized, key, {
        value: cloneSanitized(
          (value as Record<string, unknown>)[key],
          ancestors,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
}

export function sanitizeSourceContent<T>(value: T): T {
  return cloneSanitized(value, new Set()) as T;
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidSourceContent();
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) invalidSourceContent();
    return JSON.stringify(value.toISOString());
  }
  if (typeof value !== "object") invalidSourceContent();
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    invalidSourceContent();
  }
  if (Object.getOwnPropertySymbols(value).length > 0) invalidSourceContent();
  if (Array.isArray(value)) rejectSparseArray(value);
  if (ancestors.has(value)) invalidSourceContent();

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item, ancestors)).join(",")}]`;
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(
            (value as Record<string, unknown>)[key],
            ancestors,
          )}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set());
}

export function fingerprintSourceContent(raw: Record<string, unknown>): string {
  return createHash("sha256")
    .update(canonicalJson(sanitizeSourceContent(raw)))
    .digest("hex");
}
