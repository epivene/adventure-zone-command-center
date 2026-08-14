const schemePattern = /^[a-z][a-z\d+.-]*:/i;
const hostWithPortPattern = /^(?:localhost|[a-z\d-]+(?:\.[a-z\d-]+)+):\d+(?:[/?#]|$)/i;

export function normalizeExternalWebsite(value: string | null): string | null {
  if (!value) return null;

  const candidate = value.trim();
  if (!candidate) return null;

  try {
    const hasScheme = schemePattern.test(candidate) && !hostWithPortPattern.test(candidate);
    const url = new URL(hasScheme ? candidate : `https://${candidate}`);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:")
      || (url.hostname !== "localhost" && !url.hostname.includes("."))
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
