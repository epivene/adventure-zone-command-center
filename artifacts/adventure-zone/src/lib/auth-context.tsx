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
import { clearOfflineWorkspace } from "@/features/assistant-workspace/offline-store";

type AuthState = {
  /** null while the stored token is being validated on first load. */
  isSignedIn: boolean | null;
  signIn: (
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(
    getAuthToken() ? null : false,
  );

  useEffect(() => {
    let cancelled = false;
    let verification = 0;
    let observedToken = getAuthToken();
    const unsubscribe = onAuthChange((token) => {
      if (cancelled) return;
      if (token !== observedToken) {
        verification++;
        void clearOfflineWorkspace().catch(() => undefined);
        void clearAssistantCacheForActor().catch(() => undefined);
      }
      observedToken = token;
      setIsSignedIn(Boolean(token));
    });
    const verifySession = () => {
      const verificationToken = getAuthToken();
      if (!verificationToken) return;
      const sequence = ++verification;
      void apiFetch("/auth/me")
        .then((res) => {
          if (
            cancelled ||
            sequence !== verification ||
            getAuthToken() !== verificationToken
          )
            return;
          setIsSignedIn(res.ok);
          // Offline access is a separate local-only page. A service outage does
          // not validate an online session and must not erase prepared drafts.
          if (res.status === 401 || res.status === 403) {
            setAuthToken(null);
          }
        })
        .catch(() => {
          if (
            !cancelled &&
            sequence === verification &&
            getAuthToken() === verificationToken
          )
            setIsSignedIn(false);
        });
    };
    if (observedToken) verifySession();
    else {
      void clearOfflineWorkspace().catch(() => undefined);
    }
    window.addEventListener("online", verifySession);
    return () => {
      cancelled = true;
      window.removeEventListener("online", verifySession);
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (password: string) => {
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
      return {
        ok: false as const,
        error: "Could not reach the server. Try again.",
      };
    }
  }, []);

  const signOut = useCallback(() => {
    void clearAssistantCacheForActor().catch(() => undefined);
    void clearOfflineWorkspace().catch(() => undefined);
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
