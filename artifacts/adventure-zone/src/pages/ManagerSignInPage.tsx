import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  listManagerLoginLegs,
  useManagerAuth,
} from "@/lib/manager-auth-context";
import { DevelopmentLoginHint } from "@/components/auth/development-login-hint";

type ManagerLeg = { id: string; name: string };

export default function ManagerSignInPage() {
  const { manager, signIn, demoSignIn } = useManagerAuth();
  const [, navigate] = useLocation();
  const [legs, setLegs] = useState<ManagerLeg[]>([]);
  const [legId, setLegId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listManagerLoginLegs().then((availableLegs) => {
      setLegs(availableLegs);
      setLegId((currentLegId) => currentLegId || availableLegs[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    if (manager) navigate("/manager");
  }, [manager, navigate]);

  async function authenticate(selectedLegId: string, selectedPassword: string) {
    setBusy(true);
    setError("");
    try {
      await signIn(selectedLegId, selectedPassword);
      navigate("/manager");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  async function authenticateDemo() {
    setBusy(true);
    setError("");
    try {
      await demoSignIn();
      navigate("/manager");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void authenticate(legId, password);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <form
          onSubmit={submit}
          className="grid gap-4 rounded-2xl border bg-white p-6 shadow-sm"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-orange-700">
              Adventure Zone
            </p>
            <h1 className="text-2xl font-bold">Leg Manager Portal</h1>
          </div>
          <label className="grid gap-1 font-semibold">
            Travel leg
            <select
              value={legId}
              onChange={(event) => setLegId(event.target.value)}
              required
            >
              <option value="" disabled>
                Choose your leg
              </option>
              {legs.map((leg) => (
                <option key={leg.id} value={leg.id}>
                  {leg.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 font-semibold">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <button
            className="button-primary min-h-12"
            disabled={busy || !legId}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="mt-4">
          <DevelopmentLoginHint
            kind="manager"
            onUse={() => void authenticateDemo()}
          />
        </div>
      </div>
    </main>
  );
}
