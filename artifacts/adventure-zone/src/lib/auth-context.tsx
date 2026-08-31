import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  apiFetch,
  getAuthToken,
  onAuthChange,
  setAuthToken,
} from "./auth-token";
import { clearAssistantCacheForActor } from "@/features/assistant/assistant-offline-cache";
import { clearBookingReturnPath } from "@/lib/admin-workspace";

export type OwnerIdentity = {
  id: string;
  displayName: string;
  role: "owner";
};

type AuthState = {
  /** null while the stored token is being validated on first load. */
  isSignedIn: boolean | null;
  owner: OwnerIdentity | null;
  signIn: (password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => void;
  signOutAll: () => Promise<{ ok: true } | { ok: false; error: string }>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(
    getAuthToken() ? null : false,
  );
  const [owner, setOwner] = useState<OwnerIdentity | null>(null);

  const clearLocalOwnerSession = useCallback(() => {
    void clearAssistantCacheForActor().catch(() => undefined);
    clearBookingReturnPath();
    setOwner(null);
    setAuthToken(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (getAuthToken()) {
      apiFetch("/auth/me")
        .then(async (res) => {
          if (cancelled) return;
          if (res.ok) {
            const data = (await res.json()) as { owner?: OwnerIdentity };
            setOwner(data.owner ?? null);
            setIsSignedIn(true);
            return;
          }
          setIsSignedIn(false);
          clearLocalOwnerSession();
        })
        .catch(() => {
          if (!cancelled) {
            setOwner(null);
            setIsSignedIn(false);
          }
        });
    }
    const unsubscribe = onAuthChange((token) => {
      if (cancelled) return;
      setIsSignedIn(Boolean(token));
      if (!token) setOwner(null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [clearLocalOwnerSession]);

  const signIn = useCallback(
    async (password: string) => {
      try {
        const res = await apiFetch("/auth/login", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          return {
            ok: false as const,
            error: err.error ?? "Incorrect password",
          };
        }
        const data = (await res.json()) as { token: string; owner: OwnerIdentity };
        setOwner(data.owner);
        setAuthToken(data.token);
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: "Could not reach the server. Try again." };
      }
    },
    [],
  );

  const signOut = useCallback(() => {
    clearLocalOwnerSession();
  }, [clearLocalOwnerSession]);

  const signOutAll = useCallback(async () => {
    try {
      const res = await apiFetch("/auth/sign-out-all", { method: "POST" });
      if (!res.ok) {
        const error = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          ok: false as const,
          error: error.error ?? "Could not sign out every device.",
        };
      }
      clearLocalOwnerSession();
      return { ok: true as const };
    } catch {
      return {
        ok: false as const,
        error: "Could not reach the server. Your current device is still signed in.",
      };
    }
  }, [clearLocalOwnerSession]);

  return (
    <AuthContext.Provider value={{ isSignedIn, owner, signIn, signOut, signOutAll }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
