import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import type { EventFamilyDetail } from "@/features/event-families/event-family-types";

type AvailableProfile = {
  id: string;
  name: string;
  city: string | null;
  eventFamilyId?: string | null;
};

export default function EventFamilyPage() {
  const [, params] = useRoute("/event-families/:familyId");
  const familyId = params?.familyId ?? "";
  const [family, setFamily] = useState<EventFamilyDetail | null>(null);
  const [profiles, setProfiles] = useState<AvailableProfile[]>([]);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!familyId) return;
    setLoading(true);
    setError(null);
    try {
      const [familyResult, profileResult] = await Promise.all([
        apiGet<{ family: EventFamilyDetail }>(`/event-families/${familyId}`),
        apiGet<any>("/organizations?page=1"),
      ]);
      setFamily(familyResult.family);
      setName(familyResult.family.name);
      setProfiles(profileResult.organizations?.records ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Could not load event family");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [familyId]);

  const availableProfiles = profiles.filter((profile) => !profile.eventFamilyId);

  async function rename() {
    if (!family || !name.trim() || name.trim() === family.name) return;
    setSaving(true);
    try {
      await apiPatch(`/event-families/${family.id}`, { name: name.trim() });
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not rename family");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(organizationId: string, organizationName: string) {
    if (!family || !window.confirm(`Remove ${organizationName} from ${family.name}? The original profile and all of its history will stay intact.`)) return;
    setSaving(true);
    try {
      await apiDelete(`/event-families/${family.id}/members/${organizationId}`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove profile from family");
    } finally {
      setSaving(false);
    }
  }

  async function addMember() {
    if (!family || !selectedId) return;
    setSaving(true);
    try {
      await apiPost(`/event-families/${family.id}/members`, { organizationId: selectedId });
      setSelectedId("");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not add profile to family");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-slate-500">Loading event family…</p>;
  if (error && !family) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>;
  if (!family) return <p className="text-slate-500">Event family not found.</p>;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Event family</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <input className="min-w-64 rounded-lg border border-slate-300 px-3 py-2 text-2xl font-bold" value={name} onChange={(event) => setName(event.target.value)} />
          <button className="button-secondary" disabled={saving || !name.trim() || name.trim() === family.name} onClick={rename} type="button">Save name</button>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          This page groups related events for browsing only. Notes, calls, bookings, follow-ups, and edits remain on each original profile.
        </p>
      </header>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold">Add a profile</h2>
        <p className="mt-1 text-sm text-slate-500">Showing ungrouped profiles from the current profile page.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="min-w-72 rounded-lg border border-slate-300 px-3 py-2" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">Choose an ungrouped profile…</option>
            {availableProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}{profile.city ? ` — ${profile.city}` : ""}</option>
            ))}
          </select>
          <button className="button-primary" disabled={saving || !selectedId} onClick={addMember} type="button">Add to family</button>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Member profiles</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">{family.members.length}</span>
        </div>
        {family.members.map((member) => (
          <article key={member.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link className="text-lg font-bold text-orange-700 hover:underline" href={`/event-profiles/${member.id}`}>{member.name}</Link>
                <p className="mt-1 text-sm text-slate-600">{[member.city, member.region].filter(Boolean).join(", ") || "Location not set"}</p>
                <p className="mt-2 text-xs font-medium text-slate-500">{member.contactCount} contacts · {member.bookingCount} bookings{member.nextFollowUpAt ? ` · next follow-up ${new Date(member.nextFollowUpAt).toLocaleDateString()}` : ""}</p>
              </div>
              <button className="button-secondary" disabled={saving} onClick={() => removeMember(member.id, member.name)} type="button">Remove from family</button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}