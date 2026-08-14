import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useParams } from "wouter";

import { apiGet, apiPatch } from "@/lib/auth-token";

type EditableProfile = {
  place: {
    name: string;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    website: string | null;
  };
};

export default function EventProfileEditPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const [, navigate] = useLocation();
  const [profile, setProfile] = useState<EditableProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profileId) return;
    apiGet<EditableProfile>(`/event-profiles/${profileId}`)
      .then(setProfile)
      .catch(() => setError("The profile could not be loaded."))
      .finally(() => setLoading(false));
  }, [profileId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await apiPatch(`/event-profiles/${profileId}`, {
        name: String(data.get("name") ?? ""),
        phone: String(data.get("phone") ?? ""),
        address1: String(data.get("address1") ?? ""),
        address2: String(data.get("address2") ?? ""),
        city: String(data.get("city") ?? ""),
        region: String(data.get("region") ?? ""),
        postalCode: String(data.get("postalCode") ?? ""),
        website: String(data.get("website") ?? ""),
      });
      navigate(`/event-profiles/${profileId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-2xl"><p className="mt-8 text-slate-500">Loading profile…</p></div>;
  if (!profile) return <div className="mx-auto max-w-2xl"><p className="mt-8 text-rose-700">{error || "Profile not found."}</p></div>;

  const fields = [
    ["name", "Profile name", profile.place.name],
    ["phone", "Office phone", profile.place.phone],
    ["website", "Website", profile.place.website],
    ["address1", "Address line 1", profile.place.address1],
    ["address2", "Address line 2", profile.place.address2],
    ["city", "City", profile.place.city],
    ["region", "State", profile.place.region],
    ["postalCode", "ZIP code", profile.place.postalCode],
  ] as const;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Event profile</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Edit profile</h1>
      <p className="mt-2 text-sm text-slate-600">Only the profile name is required. Everything else may be left blank.</p>
      <form className="mt-8 grid gap-5" noValidate onSubmit={submit}>
        {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          {fields.map(([name, label, value]) => (
            <label className={`grid gap-1.5 font-medium ${name === "address1" || name === "address2" ? "sm:col-span-2" : ""}`} key={name}>
              {label}
              <input defaultValue={value ?? ""} name={name} type={name === "phone" ? "tel" : name === "website" ? "url" : "text"} />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="button-primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save profile"}</button>
          <button className="button-secondary" onClick={() => navigate(`/event-profiles/${profileId}`)} type="button">Cancel</button>
        </div>
      </form>
    </div>
  );
}
