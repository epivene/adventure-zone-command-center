import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "az_office_token";
const tokenListeners = new Set<(token: string | null) => void>();
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiRoot() {
  if (apiBaseUrl) return `${apiBaseUrl}/api`;
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/api`;
}
function getToken() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function setToken(token: string | null) {
  try { token ? localStorage.setItem(STORAGE_KEY, token) : localStorage.removeItem(STORAGE_KEY); } catch {}
  tokenListeners.forEach((listener) => listener(token));
}
function onTokenChange(listener: (token: string | null) => void) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export async function officeFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiRoot()}${path}`, { ...options, headers });
  if (response.status === 401 && token && path !== "/office/auth/login") setToken(null);
  return response;
}
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}
export const officeGet = <T,>(path: string) => officeFetch(path).then(json<T>);
export const officePost = <T,>(path: string, body: unknown) => officeFetch(path, { method: "POST", body: JSON.stringify(body) }).then(json<T>);
export const officePatch = <T,>(path: string, body: unknown) => officeFetch(path, { method: "PATCH", body: JSON.stringify(body) }).then(json<T>);
export const officePut = <T,>(path: string, body: unknown) => officeFetch(path, { method: "PUT", body: JSON.stringify(body) }).then(json<T>);

export type OfficeIdentity = {
  accountId: string;
  displayName: string;
  role: "office_coordinator";
  canReviewWebsiteInquiries: boolean;
};
type State = {
  office: OfficeIdentity | null;
  loading: boolean;
  signIn(loginName: string, password: string): Promise<{ ok: true } | { ok: false; error: string }>;
  demoSignIn(): Promise<{ ok: true } | { ok: false; error: string }>;
  signOut(): void;
};
const Context = createContext<State | null>(null);

export function OfficeAuthProvider({ children }: { children: ReactNode }) {
  const [office, setOffice] = useState<OfficeIdentity | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    let active = true;
    const unsubscribe = onTokenChange((token) => {
      if (active && !token) setOffice(null);
    });
    if (!getToken()) {
      setLoading(false);
      return () => { active = false; unsubscribe(); };
    }
    officeGet<{ office: OfficeIdentity }>("/office/auth/me")
      .then((data) => { if (active) setOffice(data.office); })
      .catch(() => { setToken(null); if (active) setOffice(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const signIn = useCallback(async (loginName: string, password: string) => {
    try {
      const response = await officeFetch("/office/auth/login", { method: "POST", body: JSON.stringify({ loginName, password }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        return { ok: false as const, error: payload.error ?? "Incorrect username or password" };
      }
      const data = await response.json() as { token: string; office: { id: string; displayName: string; role: "office_coordinator"; canReviewWebsiteInquiries: boolean } };
      setToken(data.token);
      setOffice({ accountId: data.office.id, displayName: data.office.displayName, role: data.office.role, canReviewWebsiteInquiries: data.office.canReviewWebsiteInquiries });
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not reach the server. Try again." };
    }
  }, []);
  const demoSignIn = useCallback(async () => {
    try {
      const response = await officeFetch("/office/auth/demo-login", { method: "POST", body: "{}" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        return { ok: false as const, error: payload.error ?? "Demo sign-in is unavailable" };
      }
      const data = await response.json() as { token: string; office: { id: string; displayName: string; role: "office_coordinator"; canReviewWebsiteInquiries: boolean } };
      setToken(data.token);
      setOffice({ accountId: data.office.id, displayName: data.office.displayName, role: data.office.role, canReviewWebsiteInquiries: data.office.canReviewWebsiteInquiries });
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not reach the server. Try again." };
    }
  }, []);
  const signOut = useCallback(() => { setToken(null); setOffice(null); }, []);
  const value = useMemo(() => ({ office, loading, signIn, demoSignIn, signOut }), [office, loading, signIn, demoSignIn, signOut]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOfficeAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("useOfficeAuth must be used within OfficeAuthProvider");
  return value;
}
