import { useEffect, useRef, useState } from "react";
import type {
  OrganizationListPage,
  OrganizationListRecord,
} from "@/features/organizations/organization-repository";
import {
  BulkDuplicateMergeError,
  mergeDuplicateGroups,
} from "@/features/organizations/bulk-duplicate-merge";
import { apiGet, apiPost } from "@/lib/auth-token";
import { useToast } from "@/hooks/use-toast";

type FamilyEvidence = {
  family: "name" | "website" | "location" | "act_relationship";
  label: string;
};

export type DuplicateGroup = {
  normalizedName: string;
  city: string;
  region: string;
  classification: "duplicate" | "location_candidate";
  groupKey?: string | null;
  candidateIds?: string[];
  evidence?: FamilyEvidence[];
  organizations: OrganizationListRecord[];
};

function isLocationCandidate(group: DuplicateGroup) {
  return group.classification === "location_candidate";
}

function identity(group: DuplicateGroup) {
  return group.groupKey ?? `duplicate:${group.normalizedName}`;
}

type MergeDialogProps = {
  group: DuplicateGroup;
  primaryId: string;
  onConfirm: () => void;
  onCancel: () => void;
  merging: boolean;
};

function MergeDialog({ group, primaryId, onConfirm, onCancel, merging }: MergeDialogProps) {
  const primary = group.organizations.find((organization) => organization.id === primaryId);
  const duplicateCount = group.organizations.length - 1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div aria-modal="true" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" role="dialog">
        <h2 className="text-lg font-bold">Confirm merge</h2>
        <p className="mt-3 text-slate-700">
          Keep <span className="font-semibold">{primary?.name}</span> and delete{" "}
          {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""}? All contacts
          and bookings will be moved to the primary record.
        </p>
        <div className="mt-6 flex gap-3">
          <button className="button-primary flex-1" disabled={merging} onClick={onConfirm}>
            {merging ? "Merging…" : "Confirm"}
          </button>
          <button className="button-secondary flex-1" disabled={merging} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkMergeDialog({
  groupCount,
  onConfirm,
  onCancel,
}: {
  groupCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div aria-modal="true" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" role="dialog">
        <h2 className="text-lg font-bold">Merge all duplicate profiles?</h2>
        <p className="mt-3 text-slate-700">
          This will merge {groupCount} duplicate group{groupCount !== 1 ? "s" : ""} into
          each marked Primary. Linked contacts, bookings, follow-ups, activities,
          history, and ACT links will move to the primary before redundant profiles
          are removed.
        </p>
        <p className="mt-3 text-sm font-semibold text-amber-800">This cannot be undone.</p>
        <div className="mt-6 flex gap-3">
          <button className="button-primary flex-1" onClick={onConfirm}>
            Merge all {groupCount} group{groupCount !== 1 ? "s" : ""}
          </button>
          <button className="button-secondary flex-1" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function LocationList({ group, primaryId, onPrimaryChange, disabled }: {
  group: DuplicateGroup;
  primaryId: string;
  onPrimaryChange: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Choose a primary only if these are true duplicates
      </legend>
      <ul className="grid gap-2">
        {group.organizations.map((organization) => {
          const selected = organization.id === primaryId;
          return (
            <li key={organization.id}>
              <label className={`flex items-start gap-3 rounded-lg border bg-white p-3 ${selected ? "border-orange-300 shadow-sm" : "border-slate-200"}`}>
                <input
                  checked={selected}
                  className="mt-0.5 accent-orange-600"
                  name={`primary-${identity(group)}`}
                  onChange={() => onPrimaryChange(organization.id)}
                  type="radio"
                  value={organization.id}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{organization.name}</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {[organization.city, organization.region].filter(Boolean).join(", ") || "Location not recorded"}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {organization.contactCount} contact{organization.contactCount !== 1 ? "s" : ""} ·{" "}
                    {organization.bookingCount} booking{organization.bookingCount !== 1 ? "s" : ""}
                  </p>
                </div>
                {selected ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">Primary</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

type OrganizationsResponse = { organizations: OrganizationListPage };

function MakeLocationsDialog({ group, onCancel, onComplete }: {
  group: DuplicateGroup;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [parentId, setParentId] = useState("");
  const [parents, setParents] = useState<OrganizationListRecord[]>([]);
  const [loadingParents, setLoadingParents] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    async function loadParents() {
      const records: OrganizationListRecord[] = [];
      let page = 1;
      let pageCount = 1;
      do {
        const response = await apiGet<OrganizationsResponse>(
          page === 1 ? "/organizations" : `/organizations?page=${page}`,
        );
        records.push(...response.organizations.records);
        pageCount = response.organizations.pageCount;
        page += 1;
      } while (page <= pageCount);
      if (!cancelled) {
        const candidateIds = new Set(group.candidateIds ?? group.organizations.map((item) => item.id));
        setParents(records.filter((record) => record.parent === null && !candidateIds.has(record.id)));
        setLoadingParents(false);
      }
    }
    loadParents().catch((caught: unknown) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : "Could not load parent organizations.");
        setLoadingParents(false);
      }
    });
    return () => { cancelled = true; };
  }, [group]);

  async function submit() {
    const candidateIds = [...(group.candidateIds ?? group.organizations.map((item) => item.id))]
      .sort((left, right) => left.localeCompare(right, "en-US"));
    if (mode === "new" && !name.trim()) return;
    if (mode === "existing" && !parentId) return;
    setPending(true);
    setError(null);
    try {
      await apiPost("/organizations/family-review", mode === "new"
        ? {
            action: "make_locations",
            candidateIds,
            parent: {
              kind: "new",
              name: name.trim(),
              ...(website.trim() ? { website: website.trim() } : {}),
              ...(phone.trim() ? { phone: phone.trim() } : {}),
            },
          }
        : {
            action: "make_locations",
            candidateIds,
            parent: { kind: "existing", parentId },
          });
      toast({ title: "Organization locations saved" });
      onComplete();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not make organization locations.");
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div aria-label="Make organization locations" aria-modal="true" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" role="dialog">
        <h2 className="text-lg font-bold">Make organization locations</h2>
        <p className="mt-2 text-sm text-slate-600">
          Keep each location profile and its local history, then place them under one parent.
        </p>
        <div className="mt-4 flex gap-4 text-sm font-semibold">
          <label><input checked={mode === "new"} className="mr-2" name="parent-mode" onChange={() => setMode("new")} type="radio" />Create a new parent</label>
          <label><input checked={mode === "existing"} className="mr-2" name="parent-mode" onChange={() => setMode("existing")} type="radio" />Use an existing parent</label>
        </div>
        {mode === "new" ? (
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm font-semibold">Parent organization name
              <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" onChange={(event) => setName(event.target.value)} value={name} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">Website (optional)
              <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" onChange={(event) => setWebsite(event.target.value)} value={website} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">Phone (optional)
              <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" onChange={(event) => setPhone(event.target.value)} value={phone} />
            </label>
          </div>
        ) : (
          <label className="mt-4 grid gap-1 text-sm font-semibold">Existing parent
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" disabled={loadingParents} onChange={(event) => setParentId(event.target.value)} value={parentId}>
              <option value="">{loadingParents ? "Loading parents…" : "Choose an eligible parent"}</option>
              {parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
            </select>
          </label>
        )}
        {error ? <p className="mt-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
        <div className="mt-6 flex gap-3">
          <button className="button-primary flex-1" disabled={pending || (mode === "new" ? !name.trim() : !parentId)} onClick={submit}>
            {mode === "new" ? "Create parent and make locations" : "Make locations"}
          </button>
          <button className="button-secondary flex-1" disabled={pending} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function evidenceLabel(evidence: FamilyEvidence) {
  if (evidence.family === "website") return "Same website domain";
  if (evidence.family === "location") return "Different cities or regions";
  if (evidence.family === "name") return "Organization names match after removing location suffixes";
  return "ACT records connect these organizations";
}

function DuplicateGroupCard({
  group,
  index,
  primaryId,
  onPrimaryChange,
  onResolved,
  disabled,
}: {
  group: DuplicateGroup;
  index: number;
  primaryId: string;
  onPrimaryChange: (id: string) => void;
  onResolved: () => void;
  disabled: boolean;
}) {
  const locationCandidate = isLocationCandidate(group);
  const [showMerge, setShowMerge] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [pending, setPending] = useState(false);
  const { toast } = useToast();

  async function merge() {
    if (!primaryId) return;
    setPending(true);
    const duplicateIds = group.organizations.filter((item) => item.id !== primaryId).map((item) => item.id);
    try {
      await apiPost("/organizations/merge", { primaryId, duplicateIds });
      toast({ title: `Merged ${duplicateIds.length} duplicate${duplicateIds.length !== 1 ? "s" : ""}` });
      onResolved();
    } catch (error: any) {
      toast({ title: "Merge failed", description: error?.message ?? "Unknown error", variant: "destructive" });
      setPending(false);
      setShowMerge(false);
    }
  }

  async function notRelated() {
    setPending(true);
    try {
      await apiPost("/organizations/family-review", {
        action: "not_related",
        candidateIds: [...(group.candidateIds ?? group.organizations.map((item) => item.id))]
          .sort((left, right) => left.localeCompare(right, "en-US")),
      });
      toast({ title: "Organizations marked as not related" });
      onResolved();
    } catch (error: any) {
      toast({ title: "Review failed", description: error?.message ?? "Unknown error", variant: "destructive" });
      setPending(false);
    }
  }

  return (
    <>
      {showMerge ? <MergeDialog group={group} merging={pending} onCancel={() => setShowMerge(false)} onConfirm={merge} primaryId={primaryId} /> : null}
      {showLocations ? <MakeLocationsDialog group={group} onCancel={() => setShowLocations(false)} onComplete={onResolved} /> : null}
      <div className={`rounded-xl border p-4 ${locationCandidate ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50"}`} data-testid={`duplicate-group-${group.groupKey ?? group.normalizedName}`}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={`text-sm font-bold ${locationCandidate ? "text-sky-900" : "text-amber-800"}`}>
              Group {index + 1} — {group.organizations.length} matching records
            </p>
            {locationCandidate ? (
              <>
                <p className="mt-1 text-sm text-sky-900">These may be locations of the same organization.</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {(group.evidence ?? []).map((item) => (
                    <li className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-sky-800" key={item.family}>{evidenceLabel(item)}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {!locationCandidate ? <button className="button-secondary text-sm" disabled={disabled || pending || !primaryId} onClick={() => setShowMerge(true)}>Merge duplicates</button> : null}
            {locationCandidate ? (
              <>
                <button className="button-primary text-sm" disabled={disabled || pending} onClick={() => setShowLocations(true)}>Same organization—make locations</button>
                <button className="button-secondary text-sm" disabled={disabled || pending} onClick={notRelated}>Not related</button>
              </>
            ) : null}
          </div>
        </div>
        <LocationList disabled={disabled || pending} group={group} onPrimaryChange={onPrimaryChange} primaryId={primaryId} />
      </div>
    </>
  );
}

function initialPrimaryIds(groups: DuplicateGroup[]) {
  return Object.fromEntries(groups.map((group) => [
    identity(group),
    isLocationCandidate(group) ? "" : group.organizations[0]?.id ?? "",
  ]));
}

function reconcilePrimaryIds(current: Record<string, string>, groups: DuplicateGroup[]) {
  return Object.fromEntries(groups.map((group) => {
    const groupIdentity = identity(group);
    if (!(groupIdentity in current)) {
      return [groupIdentity, isLocationCandidate(group) ? "" : group.organizations[0]?.id ?? ""];
    }
    const selected = current[groupIdentity];
    return [groupIdentity, group.organizations.some((item) => item.id === selected) ? selected : ""];
  }));
}

export function DuplicatesView({ groups, onRefresh }: {
  groups: DuplicateGroup[];
  onRefresh: () => Promise<DuplicateGroup[] | null>;
}) {
  const [localGroups, setLocalGroups] = useState(groups);
  const [primaryIds, setPrimaryIds] = useState<Record<string, string>>(() => initialPrimaryIds(groups));
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [bulkMerging, setBulkMerging] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ completed: 0, total: 0 });
  const [bulkError, setBulkError] = useState<BulkDuplicateMergeError | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconciliationError, setReconciliationError] = useState<string | null>(null);
  const [canResume, setCanResume] = useState(false);
  const previousGroups = useRef(groups);
  const awaitingExternalReconciliation = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    const fresh = previousGroups.current !== groups;
    previousGroups.current = groups;
    setLocalGroups(groups);
    setPrimaryIds((current) => reconcilePrimaryIds(current, groups));
    if (fresh && awaitingExternalReconciliation.current) {
      awaitingExternalReconciliation.current = false;
      setReconciliationError(null);
      setCanResume(true);
    }
  }, [groups]);

  function resolved(group: DuplicateGroup) {
    setLocalGroups((current) => current.filter((item) => identity(item) !== identity(group)));
    void onRefresh();
  }

  async function reconcileAfterFailure() {
    setReconciling(true);
    setReconciliationError(null);
    setCanResume(false);
    const refreshed = await onRefresh();
    if (refreshed === null) {
      awaitingExternalReconciliation.current = true;
      setReconciliationError("Could not confirm which merges reached the server. Check your connection and retry the status refresh.");
    } else {
      awaitingExternalReconciliation.current = false;
      setLocalGroups(refreshed);
      setPrimaryIds((current) => reconcilePrimaryIds(current, refreshed));
      setCanResume(true);
    }
    setReconciling(false);
  }

  const mergeableGroups = localGroups.filter(
    (group) => group.classification === "duplicate",
  );

  async function runBulkMerge() {
    const pendingGroups = [...mergeableGroups];
    setShowBulkDialog(false);
    setBulkError(null);
    setCanResume(false);
    setReconciliationError(null);
    setBulkProgress({ completed: 0, total: pendingGroups.length });
    setBulkMerging(true);
    try {
      const bulkPrimaryIds = Object.fromEntries(
        pendingGroups.map((group) => [
          group.normalizedName,
          primaryIds[identity(group)] ?? "",
        ]),
      );
      await mergeDuplicateGroups(
        pendingGroups,
        bulkPrimaryIds,
        async (request) => { await apiPost("/organizations/merge", request); },
        (progress) => {
          setBulkProgress({ completed: progress.completed, total: progress.total });
          setLocalGroups((current) => current.filter((group) => group.normalizedName !== progress.groupName));
        },
      );
      toast({ title: "All duplicate profiles were merged" });
      void onRefresh();
    } catch (error) {
      setBulkError(error instanceof BulkDuplicateMergeError ? error : new BulkDuplicateMergeError({
        groupName: "unknown group",
        completed: 0,
        total: pendingGroups.length,
        cause: error,
      }));
      await reconcileAfterFailure();
    } finally {
      setBulkMerging(false);
    }
  }

  const missingPrimaryGroup = mergeableGroups.find(
    (group) => !primaryIds[identity(group)],
  );

  if (!localGroups.length && !bulkMerging) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-lg font-semibold text-slate-700">No duplicate profiles found</p>
        <p className="mt-1 text-sm text-slate-500">All place profiles have unique names.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {showBulkDialog ? <BulkMergeDialog groupCount={mergeableGroups.length} onCancel={() => setShowBulkDialog(false)} onConfirm={runBulkMerge} /> : null}
      {mergeableGroups.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div>
            <p className="font-semibold text-slate-900">Merge duplicate profiles automatically</p>
            <p className="mt-0.5 text-sm text-slate-600">Location candidates are excluded until reviewed.</p>
          </div>
          {bulkMerging ? (
            <p aria-live="polite" className="font-bold text-orange-700">{reconciling ? "Checking server status…" : `Merging ${bulkProgress.completed} of ${bulkProgress.total}`}</p>
          ) : bulkError ? (
            reconciliationError ? (
              <button className="button-primary" onClick={reconcileAfterFailure}>Retry status refresh</button>
            ) : (
              <button className="button-primary" disabled={!canResume || Boolean(missingPrimaryGroup)} onClick={runBulkMerge}>
                {reconciling ? "Checking server status…" : "Resume remaining merges"}
              </button>
            )
          ) : (
            <button className="button-primary" onClick={() => setShowBulkDialog(true)}>
              Merge all {mergeableGroups.length} group{mergeableGroups.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      ) : null}

      {bulkError && !bulkMerging ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4" role="alert">
          <p className="font-semibold text-rose-800">Could not merge “{bulkError.groupName}”. {bulkError.completed} of {bulkError.total} completed.</p>
          <p className="mt-1 text-sm text-rose-700">{bulkError.cause instanceof Error ? bulkError.cause.message : "Unknown error"}</p>
          {reconciliationError ? <p className="mt-2 text-sm font-semibold text-rose-800">{reconciliationError}</p> : missingPrimaryGroup ? (
            <p className="mt-2 text-sm font-semibold text-rose-800">The previous Primary for “{missingPrimaryGroup.normalizedName}” is no longer available. Choose a Primary below before resuming.</p>
          ) : null}
        </div>
      ) : null}

      {localGroups.map((group, index) => (
        <DuplicateGroupCard
          disabled={bulkMerging}
          group={group}
          index={index}
          key={identity(group)}
          onPrimaryChange={(primaryId) => setPrimaryIds((current) => ({ ...current, [identity(group)]: primaryId }))}
          onResolved={() => resolved(group)}
          primaryId={primaryIds[identity(group)] ?? ""}
        />
      ))}
    </div>
  );
}
