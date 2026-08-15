import { useEffect, useState } from "react";
import { apiFetch, apiGet, apiPut } from "@/lib/auth-token";

type Status = { legId: string; legName: string; archivedAt: string | null; managerName: string | null; enabled: boolean; sessionVersion: number | null };

export function LegManagerAccess() {
  const [legs, setLegs] = useState<Status[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  async function load() {
    const data = await apiGet<{ legs: Status[] }>("/manager-admin/legs/access");
    setLegs(data.legs);
    setNames(Object.fromEntries(data.legs.map((leg) => [leg.legId, leg.managerName ?? ""])));
  }

  useEffect(() => { void load(); }, []);

  async function save(leg: Status) {
    const password = passwords[leg.legId] ?? "";
    if (!password) return;
    await apiPut(`/manager-admin/legs/${leg.legId}/access`, { password, managerName: names[leg.legId] || null });
    setPasswords((current) => ({ ...current, [leg.legId]: "" }));
    setMessage(`${leg.legName} portal access updated. Existing manager sessions were signed out.`);
    await load();
  }

  async function signOutAll(leg: Status) {
    if (!window.confirm(`Sign out all manager devices for ${leg.legName}?`)) return;
    const res = await apiFetch(`/manager-admin/legs/${leg.legId}/sign-out-all`, { method: "POST", body: "{}" });
    if (!res.ok) throw new Error("Could not sign out manager devices");
    setMessage(`${leg.legName} manager devices signed out.`);
    await load();
  }

  return <section className="grid gap-4 rounded-2xl border bg-white p-4" aria-labelledby="manager-access-title">
    <div><h2 id="manager-access-title" className="text-xl font-bold">Leg Manager Portal Access</h2><p className="text-sm text-slate-600">Set a manager name and write-only password for each active leg. Passwords are never shown after saving.</p></div>
    {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}
    <div className="grid gap-3">{legs.map((leg) => {
      const archived = Boolean(leg.archivedAt);
      return <div key={leg.legId} className="grid gap-3 rounded-xl border p-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
        <div><p className="font-semibold">{leg.legName}</p><p className="text-xs text-slate-500">{archived ? "Archived — portal disabled" : leg.enabled ? "Portal enabled" : "Portal not configured"}</p></div>
        <label className="grid gap-1 text-sm font-semibold">Manager name<input disabled={archived} value={names[leg.legId] ?? ""} onChange={(event) => setNames((current) => ({ ...current, [leg.legId]: event.target.value }))} /></label>
        <label className="grid gap-1 text-sm font-semibold">{leg.enabled ? "New password" : "Password"}<input disabled={archived} type="password" autoComplete="new-password" value={passwords[leg.legId] ?? ""} placeholder={leg.enabled ? "Leave blank to keep current" : "Set password"} onChange={(event) => setPasswords((current) => ({ ...current, [leg.legId]: event.target.value }))} /></label>
        <div className="flex gap-2"><button className="button-primary" disabled={archived || !(passwords[leg.legId] ?? "")} onClick={() => void save(leg)}>{leg.enabled ? "Change password" : "Enable portal"}</button>{leg.enabled ? <button className="button-secondary" disabled={archived} onClick={() => void signOutAll(leg)}>Sign Out All Devices</button> : null}</div>
      </div>;
    })}</div>
  </section>;
}
