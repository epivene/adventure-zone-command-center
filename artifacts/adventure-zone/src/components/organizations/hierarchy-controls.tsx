import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  createOrganizationParentAction,
  setOrganizationParentAction,
  ungroupOrganizationAction,
} from "@/actions/organizations";
import type { EventProfile } from "@/features/event-profiles/event-profile-repository";
import type {
  OrganizationListPage,
  OrganizationListRecord,
} from "@/features/organizations/organization-repository";
import { apiGet } from "@/lib/auth-token";

const UNGROUP_CONFIRMATION =
  "This removes the organization link only. Local history will stay on this profile.";

type HierarchyControlsProps = {
  profile: EventProfile;
  onRefresh: () => void | Promise<void>;
};

type OrganizationsResponse = {
  organizations: OrganizationListPage;
};

function actionError(result: { ok: boolean; error?: string }) {
  return result.ok ? null : result.error ?? "Could not update organization hierarchy.";
}

export function HierarchyControls({
  profile,
  onRefresh,
}: HierarchyControlsProps) {
  const [organizations, setOrganizations] = useState<OrganizationListRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedParentId, setSelectedParentId] = useState("");
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [parentName, setParentName] = useState("");
  const [parentWebsite, setParentWebsite] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOrganizationPages() {
      const records: OrganizationListRecord[] = [];
      let page = 1;
      let pageCount = 1;
      do {
        const path = page === 1 ? "/organizations" : `/organizations?page=${page}`;
        const response = await apiGet<OrganizationsResponse>(path);
        records.push(...response.organizations.records);
        pageCount = response.organizations.pageCount;
        page += 1;
      } while (page <= pageCount);

      if (!cancelled) {
        setOrganizations(records);
        setLoadError(null);
      }
    }

    loadOrganizationPages().catch((caught: unknown) => {
      if (!cancelled) {
        setLoadError(
          caught instanceof Error
            ? caught.message
            : "Could not load eligible parents.",
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const eligibleParents = useMemo(
    () =>
      organizations.filter(
        (candidate) =>
          candidate.id !== profile.id &&
          candidate.parent === null &&
          candidate.locationCount === 0,
      ),
    [organizations, profile.id],
  );

  const locations = profile.locations ?? [];
  const selectableLocations = locations.length
    ? locations.map(({ id, name }) => ({ id, name }))
    : [{ id: profile.id, name: profile.place.name }];

  async function finish(result: { ok: boolean; error?: string }) {
    const message = actionError(result);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    await onRefresh();
  }

  async function submitExistingParent(event: FormEvent) {
    event.preventDefault();
    if (!selectedParentId) return;
    setPending(true);
    setError(null);
    const result = await setOrganizationParentAction({
      childId: profile.id,
      parentId: selectedParentId,
    });
    await finish(result);
    setPending(false);
  }

  async function submitNewParent(event: FormEvent) {
    event.preventDefault();
    if (!parentName.trim() || selectedChildIds.length === 0) return;
    setPending(true);
    setError(null);
    const result = await createOrganizationParentAction({
      name: parentName.trim(),
      website: parentWebsite.trim() || null,
      phone: parentPhone.trim() || null,
      childIds: selectedChildIds,
    });
    await finish(result);
    setPending(false);
  }

  async function ungroup() {
    if (!window.confirm(UNGROUP_CONFIRMATION)) return;
    setPending(true);
    setError(null);
    const result = await ungroupOrganizationAction({ childId: profile.id });
    await finish(result);
    setPending(false);
  }

  return (
    <section
      aria-labelledby="organization-hierarchy-controls-title"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h2
        className="text-xl font-bold"
        id="organization-hierarchy-controls-title"
      >
        Organization hierarchy
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Group location profiles under one organization without moving their
        local history.
      </p>

      {error ? (
        <p
          className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {locations.length === 0 ? (
        <form className="mt-5 grid gap-3" onSubmit={submitExistingParent}>
          <label className="grid gap-1 text-sm font-semibold">
            Existing parent
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              disabled={pending}
              onChange={(event) => setSelectedParentId(event.target.value)}
              value={selectedParentId}
            >
              <option value="">Choose an eligible parent</option>
              {eligibleParents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {loadError ? (
            <p className="text-sm text-rose-700">{loadError}</p>
          ) : null}
          <button
            className="button-secondary w-fit"
            disabled={pending || !selectedParentId}
            type="submit"
          >
            {profile.parent ? "Move location" : "Add to parent"}
          </button>
        </form>
      ) : null}

      <form
        className="mt-5 grid gap-3 border-t border-slate-200 pt-5"
        onSubmit={submitNewParent}
      >
        <fieldset className="grid gap-2">
          <legend className="text-sm font-semibold">
            Location profiles for the new parent
          </legend>
          {selectableLocations.map((location) => (
            <label
              className="flex items-center gap-2 text-sm"
              key={location.id}
            >
              <input
                checked={selectedChildIds.includes(location.id)}
                disabled={pending}
                onChange={(event) =>
                  setSelectedChildIds((current) =>
                    event.target.checked
                      ? [...current, location.id]
                      : current.filter((id) => id !== location.id),
                  )
                }
                type="checkbox"
              />
              {location.name}
            </label>
          ))}
        </fieldset>
        <label className="grid gap-1 text-sm font-semibold">
          Parent name
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
            disabled={pending}
            onChange={(event) => setParentName(event.target.value)}
            required
            value={parentName}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Parent website
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
            disabled={pending}
            onChange={(event) => setParentWebsite(event.target.value)}
            value={parentWebsite}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Parent phone
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
            disabled={pending}
            onChange={(event) => setParentPhone(event.target.value)}
            value={parentPhone}
          />
        </label>
        <button
          className="button-secondary w-fit"
          disabled={
            pending || !parentName.trim() || selectedChildIds.length === 0
          }
          type="submit"
        >
          Create parent
        </button>
      </form>

      {profile.parent ? (
        <div className="mt-5 border-t border-slate-200 pt-5">
          <p className="text-sm text-slate-600">
            Currently part of {profile.parent.name}.
          </p>
          <button
            className="button-secondary mt-3"
            disabled={pending}
            onClick={ungroup}
            type="button"
          >
            Ungroup location
          </button>
        </div>
      ) : null}
    </section>
  );
}
