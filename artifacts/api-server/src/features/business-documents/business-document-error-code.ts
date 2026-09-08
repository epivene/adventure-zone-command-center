export function safeBusinessDocumentErrorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_:-]{0,79}$/.test(message) ? message : fallback;
}
