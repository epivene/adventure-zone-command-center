import { useState, type FormEvent } from "react";
import { apiPost } from "@/lib/auth-token";

export function ProfileBookingCreator({ profileId, city, region, onCreated }: {
  profileId: string;
  city: string;
  region: string;
  onCreated: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [nextActionDueAt, setNextActionDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await apiPost(`/event-profiles/${profileId}/bookings`, {
        name, city, region, startsAt, endsAt,
        status: "pending_contract",
        nextActionKind: "contract",
        nextActionDueAt,
      });
      await onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The booking could not be created.");
    } finally {
      setSaving(false);
    }
  }

  return <details className="rounded-xl border border-[#d8dfd6] bg-white p-4 shadow-sm">
    <summary className="cursor-pointer font-bold">Add booking</summary>
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
      {error ? <p className="text-sm font-semibold text-rose-700 sm:col-span-2" role="alert">{error}</p> : null}
      <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Booking name<input aria-label="Booking name" required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-semibold">Start date<input aria-label="Start date" required type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-semibold">End date<input aria-label="End date" required type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-semibold">Next action due<input aria-label="Next action due" required type="date" value={nextActionDueAt} onChange={(event) => setNextActionDueAt(event.target.value)} /></label>
      <p className="self-end text-sm text-slate-600">{city}, {region}</p>
      <button className="button-primary justify-self-start" disabled={saving} type="submit">{saving ? "Creating…" : "Create booking"}</button>
    </form>
  </details>;
}
