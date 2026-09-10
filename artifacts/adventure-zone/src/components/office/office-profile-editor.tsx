import { useState } from "react";
import { officePatch } from "@/lib/office-auth-context";

export type OfficeProfileBasics = {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
};

type ProfileSave = (profileId: string, input: Record<string, string | null>) => Promise<unknown>;

export function OfficeProfileEditor({ profile, onSaved, onCancel, saveProfile }: { profile: OfficeProfileBasics; onSaved: () => void | Promise<void>; onCancel: () => void; saveProfile?: ProfileSave }) {
  const [value, setValue] = useState({
    name: profile.name,
    description: profile.description ?? "",
    phone: profile.phone ?? "",
    address1: profile.address1 ?? "",
    address2: profile.address2 ?? "",
    city: profile.city ?? "",
    region: profile.region ?? "",
    postalCode: profile.postalCode ?? "",
    website: profile.website ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof value, next: string) => setValue((current) => ({ ...current, [key]: next }));
  async function save() {
    setBusy(true); setError("");
    try {
      const input = {
        name: value.name,
        description: value.description || null,
        phone: value.phone || null,
        address1: value.address1 || null,
        address2: value.address2 || null,
        city: value.city || null,
        region: value.region || null,
        postalCode: value.postalCode || null,
        website: value.website || null,
      };
      if (saveProfile) await saveProfile(profile.id, input);
      else await officePatch(`/office/profiles/${profile.id}`, input);
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save profile."); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-3 rounded-xl border border-orange-200 bg-orange-50/50 p-4">
    {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    <label className="grid gap-1 text-sm font-semibold">Profile name<input value={value.name} onChange={(e)=>set("name",e.target.value)}/></label>
    <label className="grid gap-1 text-sm font-semibold">Description<textarea rows={4} value={value.description} onChange={(e)=>set("description",e.target.value)}/></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold">Office phone<input type="tel" value={value.phone} onChange={(e)=>set("phone",e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-semibold">Website<input value={value.website} onChange={(e)=>set("website",e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Address line 1<input value={value.address1} onChange={(e)=>set("address1",e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-semibold sm:col-span-2">Address line 2<input value={value.address2} onChange={(e)=>set("address2",e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-semibold">City<input value={value.city} onChange={(e)=>set("city",e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-semibold">State / region<input value={value.region} onChange={(e)=>set("region",e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-semibold">ZIP / postal code<input value={value.postalCode} onChange={(e)=>set("postalCode",e.target.value)}/></label>
    </div>
    <div className="flex gap-2"><button className="button-primary" disabled={busy || !value.name.trim()} onClick={()=>void save()} type="button">{busy?"Saving…":"Save"}</button><button className="button-secondary" disabled={busy} onClick={onCancel} type="button">Cancel</button></div>
  </div>;
}
