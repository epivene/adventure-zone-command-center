import { createHash } from "node:crypto";

export const canonicalManifestDigestVersion = "canonical-json-v1" as const;

function unsupportedManifestDigestValue(): never {
  throw Object.assign(new Error("manifest_digest_unsupported_value"), {
    code: "manifest_digest_unsupported_value",
  });
}

function updateCanonicalJson(
  hash: ReturnType<typeof createHash>,
  value: unknown,
  ancestors: Set<object>,
): void {
  if (value === null) {
    hash.update("null");
    return;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    hash.update(JSON.stringify(value));
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) unsupportedManifestDigestValue();
    hash.update(JSON.stringify(value));
    return;
  }
  if (typeof value !== "object") unsupportedManifestDigestValue();
  if (ancestors.has(value)) unsupportedManifestDigestValue();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      hash.update("[");
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) unsupportedManifestDigestValue();
        if (index > 0) hash.update(",");
        updateCanonicalJson(hash, value[index], ancestors);
      }
      hash.update("]");
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) unsupportedManifestDigestValue();
    if (Object.getOwnPropertySymbols(value).length) unsupportedManifestDigestValue();
    const propertyNames = Object.getOwnPropertyNames(value);
    const keys = Object.keys(value as Record<string, unknown>).sort();
    if (propertyNames.length !== keys.length) unsupportedManifestDigestValue();
    hash.update("{");
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) unsupportedManifestDigestValue();
      if (index > 0) hash.update(",");
      hash.update(JSON.stringify(key));
      hash.update(":");
      updateCanonicalJson(hash, descriptor.value, ancestors);
    }
    hash.update("}");
  } finally {
    ancestors.delete(value);
  }
}

function updateJsonArray(hash: ReturnType<typeof createHash>, rows: readonly unknown[]) {
  const ancestors = new Set<object>();
  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0) hash.update(",");
    updateCanonicalJson(hash, rows[index], ancestors);
  }
}

/**
 * Hashes recursively canonical JSON without allocating one string for the
 * complete manifest. Array order is retained; object keys are sorted.
 */
export function digestManifestRows(
  operations: readonly unknown[],
  outcomes: readonly unknown[],
): string {
  const hash = createHash("sha256");
  hash.update('{"operations":[');
  updateJsonArray(hash, operations);
  hash.update('],"outcomes":[');
  updateJsonArray(hash, outcomes);
  hash.update("]}");
  return hash.digest("hex");
}

/** Reproduces the pre-versioned insertion-order digest for verified legacy runs. */
export function digestLegacyManifestRows(
  operations: readonly unknown[],
  outcomes: readonly unknown[],
): string {
  const hash = createHash("sha256");
  const updateRows = (rows: readonly unknown[]) => {
    for (let index = 0; index < rows.length; index += 1) {
      if (index > 0) hash.update(",");
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(rows[index]);
      } catch {
        unsupportedManifestDigestValue();
      }
      if (serialized === undefined) unsupportedManifestDigestValue();
      hash.update(serialized);
    }
  };
  hash.update('{"operations":[');
  updateRows(operations);
  hash.update('],"outcomes":[');
  updateRows(outcomes);
  hash.update("]}");
  return hash.digest("hex");
}
