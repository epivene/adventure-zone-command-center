const SIGNED_IMAGE_QUERY = /[?&](x-goog-|x-amz-|signature=|expires=|token=|se=|sig=)/i;

function safeImageSource(value: unknown, assetId: unknown): string | null {
  if (typeof assetId === "string" && assetId.length > 0) return null;
  if (typeof value !== "string" || SIGNED_IMAGE_QUERY.test(value)) return null;
  return /^(https?:\/\/|\/|data:)/i.test(value) ? value : null;
}

/**
 * Canonicalizes untrusted canvas JSON before it reaches project/version rows.
 * Managed assets persist by ID only; expiring signed URLs are bearer
 * credentials and must never be copied into durable snapshots.
 */
export function sanitizeDesignStudioCanvas(value: Record<string, unknown>): Record<string, unknown> {
  function visit(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object") return input;

    const object = Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, child]) => [key, visit(child)]),
    );
    if (object.kind === "image") {
      object.src = safeImageSource(object.src, object.assetId);
    }
    return object;
  }

  return visit(value) as Record<string, unknown>;
}