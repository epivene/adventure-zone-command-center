import { useState, type FormEvent } from "react";
import { useLocation, Redirect } from "wouter";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { useBossAuth } from "@/lib/boss-auth-context";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function BossSignInPage() {
  const { boss, signIn } = useBossAuth();
  const [, setLocation] = useLocation();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (boss) return <Redirect to="/boss" />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await signIn(loginName.trim(), password);
    setSubmitting(false);
    if (result.ok) setLocation("/boss");
    else setError(result.error);
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 text-center">
        <img
          alt="The Adventure Zone"
          className="mx-auto h-auto w-64 max-w-[75vw]"
          src={`${basePath}/adventure-zone-logo.png`}
        />
        <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Boss Workspace
        </p>
      </div>
      <form
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm"
        onSubmit={handleSubmit}
        data-testid="boss-sign-in-form"
      >
        <h1 className="mb-4 text-lg font-bold text-foreground">Sign in</h1>
        <label className="block text-sm font-semibold text-foreground" htmlFor="boss-login-name">
          Username
        </label>
        <input
          autoFocus
          autoComplete="username"
          className="mt-2"
          id="boss-login-name"
          data-testid="input-boss-login-name"
          onChange={(e) => setLoginName(e.target.value)}
          placeholder="Username"
          type="text"
          value={loginName}
        />
        <label
          className="mt-3 block text-sm font-semibold text-foreground"
          htmlFor="boss-password"
        >
          Password
        </label>
        <input
          autoComplete="current-password"
          className="mt-2"
          id="boss-password"
          data-testid="input-boss-password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          value={password}
        />
        {error ? (
          <p className="mt-3 text-sm font-medium text-destructive" role="alert" data-testid="boss-sign-in-error">
            {error}
          </p>
        ) : null}
        <Button
          className="mt-4 w-full"
          disabled={submitting || !loginName.trim() || password.length === 0}
          type="submit"
          data-testid="button-boss-sign-in"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
