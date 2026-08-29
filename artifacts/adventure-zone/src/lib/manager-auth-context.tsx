import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clearManagerPrivateData } from "./manager-sync-queue";
import { clearManagerBlobData } from "./manager-blob-queue";
import { clearManagerAssistantCache } from "@/features/manager-assistant/manager-assistant-offline-cache";

const KEY = "az_manager_token";
const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const root = base ? `${base}/api` : `${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/api`;

export type ManagerIdentity = { legId: string; legName: string; managerName: string | null };
type Ctx = { manager: ManagerIdentity | null; loading: boolean; signIn: (legId: string, password: string) => Promise<void>; demoSignIn: () => Promise<void>; signOut: () => void; managerApi: <T>(path: string, options?: RequestInit) => Promise<T> };
const Context = createContext<Ctx | null>(null);

function token() { try { return localStorage.getItem(KEY); } catch { return null; } }
function save(value: string | null) { try { value ? localStorage.setItem(KEY, value) : localStorage.removeItem(KEY); } catch {} }
async function raw(path: string, options: RequestInit = {}, bearer = token()) {
  const headers = { "Content-Type": "application/json", ...(options.headers as Record<string, string>) };
  if (bearer) (headers as Record<string, string>).Authorization = `Bearer ${bearer}`;
  return fetch(`${root}${path}`, { ...options, headers });
}

export function ManagerAuthProvider({ children }: { children: ReactNode }) {
  const [manager, setManager] = useState<ManagerIdentity | null>(null);
  const managerRef = useRef<ManagerIdentity | null>(null);
  const [loading, setLoading] = useState(!!token());
  useEffect(() => { managerRef.current = manager; }, [manager]);

  const clearCurrentSession = useCallback(() => {
    const current = managerRef.current;
    save(null);
    setManager(null);
    if (current) {
      void clearManagerPrivateData(current.legId);
      void clearManagerBlobData(current.legId);
      void clearManagerAssistantCache(current.legId);
    }
  }, []);

  const signOut = useCallback(() => clearCurrentSession(), [clearCurrentSession]);

  const managerApi = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    const requestToken = token();
    const res = await raw(path, options, requestToken);
    if (res.status === 401) {
      if (token() === requestToken) clearCurrentSession();
      throw Object.assign(new Error("Manager session expired"), { status: 401 });
    }
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string };
      throw Object.assign(new Error(payload.error ?? `API ${res.status}`), { status: res.status });
    }
    return res.json() as Promise<T>;
  }, [clearCurrentSession]);

  useEffect(() => {
    const bootstrapToken = token();
    if (!bootstrapToken) { setLoading(false); return; }
    raw("/manager/auth/me", {}, bootstrapToken)
      .then(async (res) => {
        if (!res.ok) throw Object.assign(new Error("Manager session expired"), { status: res.status });
        return res.json() as Promise<{ manager: ManagerIdentity }>;
      })
      .then((response) => {
        if (token() === bootstrapToken) setManager(response.manager);
      })
      .catch(() => {
        if (token() === bootstrapToken) clearCurrentSession();
      })
      .finally(() => setLoading(false));
  }, [clearCurrentSession]);

  const signIn = useCallback(async (legId: string, password: string) => {
    const res = await raw("/manager/auth/login", { method: "POST", body: JSON.stringify({ legId, password }) }, null);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string };
      throw Object.assign(new Error(payload.error ?? "Could not sign in"), { status: res.status });
    }
    const data = await res.json() as { token: string; manager: ManagerIdentity };
    const previous = managerRef.current;
    if (previous && previous.legId !== data.manager.legId) {
      void clearManagerPrivateData(previous.legId);
      void clearManagerBlobData(previous.legId);
      void clearManagerAssistantCache(previous.legId);
    }
    save(data.token);
    setManager(data.manager);
    setLoading(false);
  }, []);

  const demoSignIn = useCallback(async () => {
    const res = await raw("/manager/auth/demo-login", { method: "POST", body: "{}" }, null);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string };
      throw Object.assign(new Error(payload.error ?? "Demo sign-in is unavailable"), { status: res.status });
    }
    const data = await res.json() as { token: string; manager: ManagerIdentity };
    save(data.token);
    setManager(data.manager);
    setLoading(false);
  }, []);

  const value = useMemo(() => ({ manager, loading, signIn, demoSignIn, signOut, managerApi }), [manager, loading, signIn, demoSignIn, signOut, managerApi]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useManagerAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("useManagerAuth must be inside ManagerAuthProvider");
  return context;
}

export async function listManagerLoginLegs(): Promise<{ id: string; name: string }[]> {
  const res = await raw("/manager/auth/legs", {}, null);
  if (!res.ok) return [];
  return ((await res.json()) as { legs: { id: string; name: string }[] }).legs;
}
