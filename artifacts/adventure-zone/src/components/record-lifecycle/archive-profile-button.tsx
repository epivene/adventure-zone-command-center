import { useState } from "react";

import { archiveProfile } from "@/actions/profile-lifecycle";

const warning = "Archive this profile? It will disappear from Profiles, search, caller matching, Today, and normal event selection. Its contacts, bookings, notes, history, and relationships will stay intact.";

export function ArchiveProfileButton({
  profileId,
  onArchived,
}: {
  profileId: string;
  onArchived: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    if (saving || !window.confirm(warning)) return;
    setSaving(true);
    setError(null);
    try {
      await archiveProfile(profileId);
      onArchived();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not archive this profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid w-fit gap-1">
      <button
        className="min-h-10 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:opacity-60"
        disabled={saving}
        onClick={() => void archive()}
        type="button"
      >
        {saving ? "Archiving…" : "Archive profile"}
      </button>
      {error ? <p className="text-xs text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}
