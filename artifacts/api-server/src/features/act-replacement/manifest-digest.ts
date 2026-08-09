import { createHash } from "node:crypto";

function updateJsonArray(hash: ReturnType<typeof createHash>, rows: readonly unknown[]) {
  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0) hash.update(",");
    hash.update(JSON.stringify(rows[index]) ?? "null");
  }
}

/**
 * Hashes the canonical manifest JSON without allocating one string for the
 * complete manifest. The emitted bytes exactly match
 * JSON.stringify({ operations, outcomes }) for JSON-compatible row objects.
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
