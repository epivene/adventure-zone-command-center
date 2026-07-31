const sharedMailboxLocalParts = new Set([
  "admin",
  "billing",
  "bookings",
  "boxoffice",
  "contact",
  "customerservice",
  "events",
  "hello",
  "info",
  "inquiries",
  "office",
  "reservations",
  "sales",
  "support",
  "tickets",
]);

const genericContactNames = new Set([
  "info",
  "office",
  "sales",
  "support",
  "box office",
  "reservations",
  "general contact",
]);

export function normalizeMatchingText(value: string | null): string | null {
  const normalized =
    value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") ?? "";
  return normalized || null;
}

export function normalizeMatchingEmail(value: string | null): string | null {
  const normalized = value?.trim().toLocaleLowerCase("en-US") ?? "";
  if (!normalized || normalized.includes("..")) return null;
  const [localPart = ""] = normalized.split("@");
  if (localPart.startsWith(".") || localPart.endsWith(".")) return null;
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      normalized,
    )
  ) {
    return null;
  }
  return normalized;
}

export function isSharedMailboxEmail(value: string | null): boolean {
  const email = normalizeMatchingEmail(value);
  if (!email) return false;
  const [localPart = ""] = email.split("@");
  const mailbox = localPart.split("+", 1)[0] ?? "";
  return sharedMailboxLocalParts.has(mailbox);
}

export function isGenericContactName(
  displayName: string | null,
  companyName: string | null,
): boolean {
  const name = normalizeMatchingText(displayName);
  if (!name) return true;
  const company = normalizeMatchingText(companyName);
  return genericContactNames.has(name) || (company !== null && name === company);
}

export function normalizeWebsiteHost(value: string | null): string | null {
  const input = value?.trim();
  if (!input || /^[a-z][a-z\d+.-]*:\/{3,}/i.test(input)) return null;

  const hasScheme = /^https?:\/\//i.test(input);
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input) && !hasScheme) return null;

  try {
    const url = new URL(hasScheme ? input : `https://${input}`);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }

    let hostname = url.hostname.toLocaleLowerCase("en-US");
    if (hostname.endsWith(".")) hostname = hostname.slice(0, -1);
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    if (
      !hostname ||
      hostname.includes("..") ||
      !hostname.includes(".") ||
      !hostname
        .split(".")
        .every(
          (label) =>
            /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
        )
    ) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}
