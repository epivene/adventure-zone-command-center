import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clearManagerPrivateData } from "./manager-sync-queue";
import { clearManagerBlobData } from "./manager-blob-queue";

const KEY = "az_manager_token";
const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const root = base ? `${base}/api` : `${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/api`;

export type ManagerIdentity = { legId: string; legName: string; managerName: string | null };
type Ctx = { manager: ManagerIdentity | null; loading: boolean; signIn: (legId: string, password: string) => Promise<void>; signOut: () => void; managerApi: <T>(path: string, options?: RequestInit) => Promise<T> };
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

  const signOut = useCallback(() => {
    const current = managerRef.current;
    save(null);
    setManager(null);
    if (current) {
      void clearManagerPrivateData(current.legId);
      void clearManagerBlobData(current.legId);
    }
  }, []);

  const managerApi = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    const res = await raw(path, options);
    if (res.status === 401) {
      signOut();
      throw Object.assign(new Error("Manager session expired"), { status: 401 });
    }
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string };
      throw Object.assign(new Error(payload.error ?? `API ${res.status}`), { status: res.status });
    }
    return res.json() as Promise<T>;
  }, [signOut]);

  useEffect(() => {
    if (!token()) { setLoading(false); return; }
    managerApi<{ manager: ManagerIdentity }>("/manager/auth/me")
      .then((response) => setManager(response.manager))
      .catch(() => signOut())
      .finally(() => setLoading(false));
  }, [managerApi, signOut]);

  const signIn = useCallback(async (legId: string, password: string) => {
    const res = await raw("/manager/auth/login", { method: "POST", body: JSON.stringify({ legId, password }) }, null);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string };
      throw Object.assign(new Error(payload.error ?? "Could not sign in"), { status: res.status });
    }
    const data = await res.json() as { token: string; manager: ManagerIdentity };
    save(data.token);
    setManager(data.manager);
  }, []);

  const value = useMemo(() => ({ manager, loading, signIn, signOut, managerApi }), [manager, loading, signIn, signOut, managerApi]);
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
