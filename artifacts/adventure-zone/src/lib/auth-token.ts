// Module-level token store so action functions can include auth headers
// without needing React hook context.
let currentToken: string | null = null;

export function setAuthToken(token: string | null) {
  currentToken = token;
}

export function getAuthToken(): string | null {
  return currentToken;
}

/** Authenticated fetch wrapper. Adds Authorization header when token is present. */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  // Auth is cookie-based (Clerk session cookie, same-origin) — no token header.
  return fetch(`${base}/api${path}`, { ...options, headers, credentials: "include" });
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err?.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err?.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}
