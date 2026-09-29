const PROFILE_ORIGIN_LABEL_KEY = "adventure-zone.profile-origin-label";

function pathWithoutQuery(path: string) {
  return path.split("?")[0].replace(/\/+$/, "") || "/";
}

export function profileOriginLabel(path: string) {
  const normalizedPath = pathWithoutQuery(path);
  if (normalizedPath === "/today") return "Today";
  if (normalizedPath === "/profiles" || normalizedPath === "/event-profiles") return "Profiles";
  if (normalizedPath === "/bookings" || normalizedPath.startsWith("/bookings/")) return "Bookings";
  if (normalizedPath === "/schedule") return "Schedule";
  if (normalizedPath === "/contacts" || normalizedPath.startsWith("/contacts/")) return "Contacts";
  if (normalizedPath === "/research-sources") return "Research";
  if (normalizedPath === "/routes" || normalizedPath.startsWith("/routes/")) return "Routes";
  if (normalizedPath === "/trips" || normalizedPath.startsWith("/trips/")) return "Trips";
  if (normalizedPath === "/command") return "Command Center";
  if (normalizedPath === "/") return "Home";

  const segment = normalizedPath.split("/").filter(Boolean)[0];
  return segment ? segment.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Profiles";
}

export function rememberProfileOrigin(path: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PROFILE_ORIGIN_LABEL_KEY, profileOriginLabel(path));
  } catch {
    // Session storage may be unavailable in privacy-restricted browsers.
  }
}

export function readProfileOriginLabel() {
  if (typeof window === "undefined") return "Profiles";
  try {
    return window.sessionStorage.getItem(PROFILE_ORIGIN_LABEL_KEY) || "Profiles";
  } catch {
    return "Profiles";
  }
}
const PROFILE_RETURN_KEY = "adventure-zone.profile-return";
function safeReturnPath(path: unknown): path is string {
  return typeof path === "string" && /^\/(?![\/\\])/.test(path) && !/[\\\r\n]/.test(path);
}
export function saveProfileReturnState(path: string, scrollY: number): void {
  try {
    if (!safeReturnPath(path)) { window.sessionStorage.removeItem(PROFILE_RETURN_KEY); return; }
    window.sessionStorage.setItem(PROFILE_RETURN_KEY, JSON.stringify({ path, scrollY: Math.max(0, scrollY) }));
    rememberProfileOrigin(path);
  } catch { /* Storage is optional. */ }
}
export function readProfileReturnState(): { path: string; scrollY: number } | null {
  try {
    const state = JSON.parse(window.sessionStorage.getItem(PROFILE_RETURN_KEY) || "null");
    return state && safeReturnPath(state.path) && Number.isFinite(state.scrollY) && state.scrollY >= 0 ? state : null;
  } catch { return null; }
}
