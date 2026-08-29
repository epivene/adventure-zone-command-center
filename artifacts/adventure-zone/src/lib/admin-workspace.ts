export type AdminWorkspace = "command" | "booking" | "marketing" | "operations" | "admin";

export const BOOKING_RETURN_STORAGE_KEY = "adventure-zone:booking-return-path";

const bookingPrefixes = [
  "/today",
  "/profiles",
  "/organizations",
  "/event-families",
  "/event-profiles",
  "/contacts",
  "/bookings",
  "/schedule",
  "/calendar",
  "/calls",
  "/research-sources",
  "/imports/leads",
  "/needs-answer",
  "/quick-add",
  "/office-coordinator",
] as const;

const operationsPrefixes = [
  "/operations",
  "/trips",
  "/manager-communications",
  "/manager-finance",
  "/manager-crew",
  "/manager-aftermath",
  "/manager-issues",
] as const;

function pathnameOnly(value: string): string {
  return value.split(/[?#]/, 1)[0] || "/";
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function adminWorkspaceForPath(value: string): AdminWorkspace {
  const path = pathnameOnly(value);
  if (matchesPrefix(path, "/command")) return "command";
  if (matchesPrefix(path, "/marketing") || matchesPrefix(path, "/design-studio")) return "marketing";
  if (operationsPrefixes.some((prefix) => matchesPrefix(path, prefix))) return "operations";
  if (bookingPrefixes.some((prefix) => matchesPrefix(path, prefix))) return "booking";
  return "admin";
}

export function isBookingPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  return adminWorkspaceForPath(value) === "booking";
}

function browserSessionStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function saveBookingReturnPath(path: string, storage = browserSessionStorage()): boolean {
  if (!storage || !isBookingPath(path)) return false;
  try {
    storage.setItem(BOOKING_RETURN_STORAGE_KEY, path);
    return true;
  } catch {
    return false;
  }
}

export function readBookingReturnPath(storage = browserSessionStorage()): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(BOOKING_RETURN_STORAGE_KEY);
    return value && isBookingPath(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearBookingReturnPath(storage = browserSessionStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(BOOKING_RETURN_STORAGE_KEY);
  } catch {
    // Navigation state is best-effort and must never block sign-out or rendering.
  }
}
