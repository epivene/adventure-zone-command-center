// Token store backed by localStorage so the owner session persists across
// page reloads (~30 days, enforced server-side by the token's expiry).
const STORAGE_KEY = "az_owner_token";

type AuthChangeListener = (token: string | null) => void;
const listeners = new Set<AuthChangeListener>();

export function onAuthChange(listener: AuthChangeListener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.storageArea === localStorage &&
      (event.key === STORAGE_KEY || event.key === null)
    ) {
      listener(getAuthToken());
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setAuthToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable — session just won't persist.
  }
  listeners.forEach((listener) => listener(token));
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Optional absolute API origin (e.g. the Render API service URL). Empty on
// Replit, where /api is same-origin behind the shared proxy.
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiRoot(): string {
  if (apiBaseUrl) return `${apiBaseUrl}/api`;
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/api`;
}

/** Authenticated fetch wrapper. Adds Authorization header when token is present. */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${apiRoot()}${path}`, { ...options, headers });
  // Expired/invalid token: clear it so the app returns to sign-in.
  if (
    res.status === 401 &&
    token &&
    getAuthToken() === token &&
    path !== "/auth/login"
  ) {
    setAuthToken(null);
  }
  return res;
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
    const err = (await res.json().catch(() => ({}))) as any;
    throw new Error(err?.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as any;
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
    const err = (await res.json().catch(() => ({}))) as any;
    throw new Error(err?.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as any;
    throw new Error(err?.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "DELETE",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as any;
    throw new Error(err?.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}
