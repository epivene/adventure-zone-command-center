import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import { ProfileMemberPicker } from "@/components/event-families/profile-member-picker";
import { EventFamilyWebsiteContacts } from "@/components/event-families/event-family-website-contacts";
import { EventRatingSummary } from "@/components/event-profiles/event-rating-summary";
import type { EventFamilyDetail } from "@/features/event-families/event-family-types";
import { ScopedNotes } from "@/components/notes/scoped-notes";
import { createFamilyNote, deleteFamilyNote, listFamilyNotes, updateFamilyNote } from "@/actions/scoped-notes";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";

export default function EventFamilyPage() {
  const [, params] = useRoute("/event-families/:familyId");
  const familyId = params?.familyId ?? "";
  const [family, setFamily] = useState<EventFamilyDetail | null>(null);
  const [ratingSummary, setRatingSummary] = useState<{ average: number | null; count: number }>({ average: null, count: 0 });
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familyNotes, setFamilyNotes] = useState<ScopedNoteView[]>([]);
  const [familyNotesError, setFamilyNotesError] = useState<string | null>(null);

  async function load() {
    if (!familyId) return;
    setLoading(true);
    setError(null);
    try {
      const [result, rating] = await Promise.all([
        apiGet<{ family: EventFamilyDetail }>(`/event-families/${familyId}`),
        apiGet<{ average: number | null; count: number }>(`/event-wrap-up-ratings/family/${familyId}`).catch(() => ({ average: null, count: 0 })),
      ]);
      setFamily(result.family);
      setName(result.family.name);
      setRatingSummary(rating);
    } catch (err: any) {
      setError(err?.message ?? "Could not load event family");
    } finally {
      setLoading(false);
    }
  }

  async function loadNotes() {
    if (!familyId) return;
    setFamilyNotesError(null);
    try { setFamilyNotes(await listFamilyNotes(familyId)); } catch { setFamilyNotesError("Could not load family notes."); }
  }

  useEffect(() => {
    void load();
    void loadNotes();
  }, [familyId]);

  async function rename() {
    if (!family || !name.trim() || name.trim() === family.name) return;
    setSaving(true);
    setError(null);
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
    setError(null);
    try {
      await apiDelete(`/event-families/${family.id}/members/${organizationId}`);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not remove profile from family");
    } finally {
      setSaving(false);
    }
  }

  async function addMember(organizationId: string) {
    if (!family) return;
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/event-families/${family.id}/members`, { organizationId });
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
          <input
            className="min-w-64 rounded-lg border border-slate-300 px-3 py-2 text-2xl font-bold"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="button-secondary" disabled={saving || !name.trim() || name.trim() === family.name} onClick={rename} type="button">Save name</button>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Related events live together here while each underlying profile keeps its own contacts, calls, notes, bookings, follow-ups, and history.
        </p>
      </header>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
      <EventRatingSummary average={ratingSummary.average} count={ratingSummary.count} />
      <EventFamilyWebsiteContacts family={family} onChanged={load} />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {familyNotesError ? (
          <div className="grid gap-2">
            <h2 className="text-lg font-bold">Family notes</h2>
            <p className="text-sm text-rose-700" role="alert">{familyNotesError}</p>
            <button className="button-secondary w-fit" type="button" onClick={() => void loadNotes()}>Retry family notes</button>
          </div>
        ) : (
          <ScopedNotes
            title="Family notes"
            notes={familyNotes}
            onCreate={(body) => createFamilyNote(family.id, body)}
            onUpdate={(noteId, body) => updateFamilyNote(family.id, noteId, body)}
            onDelete={(noteId) => deleteFamilyNote(family.id, noteId)}
          />
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Add events to this family</h2>
            <p className="mt-1 text-sm text-slate-500">Search every profile, or create a brand-new event already assigned to this family.</p>
          </div>
          <Link className="button-secondary" href={`/event-profiles/new?familyId=${family.id}`}>Create new event in this family</Link>
        </div>
        <div className="mt-4">
          <ProfileMemberPicker familyId={family.id} disabled={saving} onSelect={addMember} />
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Member profiles</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">{family.members.length}</span>
        </div>
        {family.members.length ? family.members.map((member) => (
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
        )) : (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No event profiles are in this family yet.</p>
        )}
      </section>
    </div>
  );
}
