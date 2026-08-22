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

type AuthState = {
  /** null while the stored token is being validated on first load. */
  isSignedIn: boolean | null;
  signIn: (password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(
    getAuthToken() ? null : false,
  );

  useEffect(() => {
    let cancelled = false;
    if (getAuthToken()) {
      apiFetch("/auth/me")
        .then((res) => {
          if (!cancelled) setIsSignedIn(res.ok);
          if (!res.ok) {
            setAuthToken(null);
            void clearAssistantCacheForActor().catch(() => undefined);
          }
        })
        .catch(() => {
          if (!cancelled) setIsSignedIn(false);
        });
    }
    const unsubscribe = onAuthChange((token) => {
      if (!cancelled) setIsSignedIn(Boolean(token));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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
        const data = (await res.json()) as { token: string };
        setAuthToken(data.token);
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: "Could not reach the server. Try again." };
      }
    },
    [],
  );

  const signOut = useCallback(() => {
    void clearAssistantCacheForActor().catch(() => undefined);
    clearBookingReturnPath();
    setAuthToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ isSignedIn, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
