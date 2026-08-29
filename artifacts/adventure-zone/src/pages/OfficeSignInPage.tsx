import { useState, type FormEvent } from "react";
import { Redirect, useLocation } from "wouter";
import { useOfficeAuth } from "@/lib/office-auth-context";
import { DevelopmentLoginHint } from "@/components/auth/development-login-hint";

export default function OfficeSignInPage() {
  const { office, signIn, demoSignIn } = useOfficeAuth();
  const [, setLocation] = useLocation();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (office) return <Redirect to="/office" />;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    const result = await signIn(loginName, password); setBusy(false);
    if (result.ok) setLocation("/office"); else setError(result.error);
  }
  async function demoSubmit() {
    if (busy) return;
    setBusy(true); setError("");
    const result = await demoSignIn();
    setBusy(false);
    if (result.ok) setLocation("/office"); else setError(result.error);
  }
  return <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4">
    <div className="w-full max-w-sm">
      <div className="mb-7 text-center"><h1 className="text-2xl font-bold">Adventure Zone</h1><p className="mt-1 font-semibold text-orange-700">Office Coordinator</p></div>
      <form className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={submit}>
        <div><h2 className="text-xl font-bold">Booking Workspace</h2><p className="mt-1 text-sm text-slate-600">Sign in to continue your office work.</p></div>
        <label className="grid gap-1.5 text-sm font-semibold">Username<input autoComplete="username" autoFocus value={loginName} onChange={(e)=>setLoginName(e.target.value)} /></label>
        <label className="grid gap-1.5 text-sm font-semibold">Password<input autoComplete="current-password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} /></label>
        {error?<p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p>:null}
        <button className="button-primary" disabled={busy||!loginName.trim()||!password} type="submit">{busy?"Signing in…":"Sign in"}</button>
      </form>
      <div className="mt-4"><DevelopmentLoginHint kind="office" onUse={() => void demoSubmit()} /></div>
    </div>
  </div>;
}
