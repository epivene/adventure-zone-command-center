import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "az_boss_token";
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
  tokenListeners.forEach((l) => l(token));
}

function onTokenChange(listener: (token: string | null) => void) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export async function bossFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiRoot()}${path}`, { ...options, headers });
  if (res.status === 401 && token && path !== "/boss/auth/login") setToken(null);
  return res;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const bossGet = <T,>(path: string) => bossFetch(path).then(json<T>);
export const bossPost = <T,>(path: string, body: unknown) =>
  bossFetch(path, { method: "POST", body: JSON.stringify(body) }).then(json<T>);
export const bossPatch = <T,>(path: string, body: unknown) =>
  bossFetch(path, { method: "PATCH", body: JSON.stringify(body) }).then(json<T>);
export const bossPut = <T,>(path: string, body: unknown) =>
  bossFetch(path, { method: "PUT", body: JSON.stringify(body) }).then(json<T>);
export const bossDelete = <T,>(path: string) =>
  bossFetch(path, { method: "DELETE" }).then(json<T>);

export type BossIdentity = { id: string; displayName: string; role: "boss" };

type State = {
  boss: BossIdentity | null;
  loading: boolean;
  signIn(loginName: string, password: string): Promise<{ ok: true } | { ok: false; error: string }>;
  demoSignIn(): Promise<{ ok: true } | { ok: false; error: string }>;
  signOut(): void;
};

const Context = createContext<State | null>(null);

export function BossAuthProvider({ children }: { children: ReactNode }) {
  const [boss, setBoss] = useState<BossIdentity | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    let active = true;
    const unsub = onTokenChange((token) => {
      if (active && !token) setBoss(null);
    });
    if (!getToken()) {
      setLoading(false);
      return () => { active = false; unsub(); };
    }
    bossGet<{ boss: BossIdentity }>("/boss/auth/me")
      .then((data) => { if (active) setBoss(data.boss); })
      .catch(() => { setToken(null); if (active) setBoss(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsub(); };
  }, []);

  const signIn = useCallback(async (loginName: string, password: string) => {
    try {
      const res = await bossFetch("/boss/auth/login", {
        method: "POST",
        body: JSON.stringify({ loginName, password }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        return { ok: false as const, error: payload.error ?? "Incorrect username or password" };
      }
      const data = await res.json() as { token: string; boss: BossIdentity };
      setToken(data.token);
      setBoss(data.boss);
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not reach the server. Try again." };
    }
  }, []);

  const demoSignIn = useCallback(async () => {
    try {
      const res = await bossFetch("/boss/auth/demo-login", { method: "POST", body: "{}" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        return { ok: false as const, error: payload.error ?? "Demo sign-in is unavailable" };
      }
      const data = await res.json() as { token: string; boss: BossIdentity };
      setToken(data.token);
      setBoss(data.boss);
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not reach the server. Try again." };
    }
  }, []);

  const signOut = useCallback(() => { setToken(null); setBoss(null); }, []);

  const value = useMemo(
    () => ({ boss, loading, signIn, demoSignIn, signOut }),
    [boss, loading, signIn, demoSignIn, signOut],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBossAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("useBossAuth must be used within BossAuthProvider");
  return value;
}

export function getBossToken() {
  return getToken();
}
