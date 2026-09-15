import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OrganizationListPage,
  OrganizationListRecord,
} from "@/features/organizations/organization-repository";
import {
  BulkDuplicateMergeError,
  mergeDuplicateGroups,
} from "@/features/organizations/bulk-duplicate-merge";
import { apiGet, apiPost } from "@/lib/auth-token";
import { useToast } from "@workspace/avz-crm/hooks/use-toast";
import { ConsolidationDialog } from "./consolidation-dialog";
import { buildDuplicateMergeRequest } from "./duplicate-merge-request";

type FamilyEvidence = {
  family: "name" | "website" | "location" | "address" | "act_relationship";
  label: string;
};

export type DuplicateGroup = {
  normalizedName: string;
  city: string;
  region: string;
  classification: "duplicate" | "location_candidate" | "ambiguous_location_candidate";
  groupKey?: string | null;
  candidateIds?: string[];
  evidence?: FamilyEvidence[];
  organizations: OrganizationListRecord[];
};

function isLocationCandidate(group: DuplicateGroup) {
  return group.classification !== "duplicate";
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
          and bookings will be moved to the primary profile.
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

function EventFamilyDialog({
  group,
  pending,
  onCancel,
  onConfirm,
}: {
  group: DuplicateGroup;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(group.normalizedName || group.organizations[0]?.name || "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div aria-modal="true" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" role="dialog">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">Event family</p>
        <h2 className="mt-1 text-lg font-bold">Group these as an Event Family</h2>
        <p className="mt-2 text-sm text-slate-600">
          Only the selected profiles will be grouped. Each profile stays separate with its own city, contacts, bookings, notes, and history.
        </p>
        <label className="mt-4 grid gap-1 text-sm font-semibold">
          Family name
          <input
            autoFocus
            disabled={pending}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="e.g. Field of Honor"
            value={name}
          />
        </label>
        <div className="mt-6 flex gap-3">
          <button
            className="button-primary flex-1"
            disabled={pending || !name.trim()}
            onClick={() => onConfirm(name.trim())}
            type="button"
          >
            {pending ? "Creating…" : "Create Event Family"}
          </button>
          <button className="button-secondary flex-1" disabled={pending} onClick={onCancel} type="button">
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

function LocationList({
  group,
  primaryId,
  selectedIds,
  onPrimaryChange,
  onSelectionChange,
  disabled,
}: {
  group: DuplicateGroup;
  primaryId: string;
  selectedIds: Set<string>;
  onPrimaryChange: (id: string) => void;
  onSelectionChange: (id: string, selected: boolean) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Select the profiles this action should apply to. Pick a primary only when merging true duplicates.
      </legend>
      <ul className="grid gap-2">
        {group.organizations.map((organization) => {
          const included = selectedIds.has(organization.id);
          const primary = organization.id === primaryId;
          return (
            <li key={organization.id}>
              <div className={`rounded-lg border bg-white p-3 ${primary ? "border-orange-300 shadow-sm" : included ? "border-sky-200" : "border-slate-200 opacity-65"}`}>
                <div className="flex items-start gap-3">
                  <input
                    aria-label={`Include ${organization.name} in this action`}
                    checked={included}
                    className="mt-1 accent-orange-600"
                    onChange={(event) => onSelectionChange(organization.id, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <div className="min-w-0 flex-1">
                    <a
                      aria-label={`Open ${organization.name} profile`}
                      className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-orange-700"
                      href={`/profiles/${organization.id}`}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {organization.name}
                    </a>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {[organization.city, organization.region].filter(Boolean).join(", ") || "Location not recorded"}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {organization.contactCount} contact{organization.contactCount !== 1 ? "s" : ""} ·{" "}
                      {organization.bookingCount} booking{organization.bookingCount !== 1 ? "s" : ""}
                    </p>
                    <a
                      className="mt-2 inline-block text-xs font-bold text-sky-800 hover:text-sky-950"
                      href={`/profiles/${organization.id}`}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      View full profile ↗
                    </a>
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-600">
                    <input
                      aria-label={`Make ${organization.name} primary`}
                      checked={primary}
                      disabled={!included}
                      name={`primary-${identity(group)}`}
                      onChange={() => onPrimaryChange(organization.id)}
                      type="radio"
                      value={organization.id}
                    />
                    Primary
                  </label>
                </div>
                {primary ? <span className="mt-2 inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">Primary</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function evidenceLabel(evidence: FamilyEvidence) {
  if (evidence.family === "website") return "Same website domain";
  if (evidence.family === "location") return "Different cities or regions";
  if (evidence.family === "name") return "Profile names match after removing location suffixes";
  if (evidence.family === "address") return "Street addresses repeat across different locations";
  return "ACT records connect these profiles";
}

function RelationshipChoiceGuide() {
  return (
    <div className="mb-3 grid gap-1 rounded-lg border border-slate-200 bg-white/80 p-3 text-xs text-slate-700 sm:grid-cols-2">
      <p><strong>Merge duplicates:</strong> Same profile entered more than once.</p>
      <p><strong>Profile Locations:</strong> One profile with multiple venues or addresses.</p>
      <p><strong>Event Family:</strong> Related profiles that should keep separate history.</p>
      <p><strong>Not related:</strong> The match is wrong; keep the profiles separate.</p>
    </div>
  );
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
  onResolved: (subsetApplied: boolean) => void;
  disabled: boolean;
}) {
  const locationCandidate = isLocationCandidate(group);
  const [showMerge, setShowMerge] = useState(false);
  const [showConsolidate, setShowConsolidate] = useState(false);
  const [showEventFamily, setShowEventFamily] = useState(false);
  const [pending, setPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(group.organizations.map((item) => item.id)),
  );
  const { toast } = useToast();

  const organizationIdSignature = group.organizations.map((item) => item.id).join("|");
  useEffect(() => {
    setSelectedIds(new Set(group.organizations.map((item) => item.id)));
  }, [organizationIdSignature]);

  const selectedOrganizations = useMemo(
    () => group.organizations.filter((item) => selectedIds.has(item.id)),
    [group.organizations, selectedIds],
  );
  const selectedGroup = useMemo<DuplicateGroup>(() => ({
    ...group,
    candidateIds: selectedOrganizations.map((item) => item.id),
    organizations: selectedOrganizations,
  }), [group, selectedOrganizations]);
  const sourceOrgIds = selectedOrganizations.map((item) => item.id);
  const sourceOrgNames = selectedOrganizations.map((item) => item.name);
  const selectedCount = selectedOrganizations.length;
  const selectionReady = selectedCount >= 2;
  const subsetApplied = selectedCount < group.organizations.length;
  const mergePrimaryReady = Boolean(primaryId && selectedIds.has(primaryId));

  function changeSelection(id: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      if (!selected && primaryId === id) {
        const replacement = group.organizations.find((item) => next.has(item.id));
        onPrimaryChange(replacement?.id ?? "");
      } else if (selected && !primaryId && group.classification === "duplicate") {
        onPrimaryChange(id);
      }
      return next;
    });
  }

  async function merge() {
    if (!mergePrimaryReady || !selectionReady) return;
    setPending(true);
    const duplicateIds = selectedOrganizations.filter((item) => item.id !== primaryId).map((item) => item.id);
    try {
      await apiPost("/organizations/merge", buildDuplicateMergeRequest({
        classification: group.classification,
        primaryId,
        duplicateIds,
      }));
      toast({ title: `Merged ${duplicateIds.length} duplicate${duplicateIds.length !== 1 ? "s" : ""}` });
      onResolved(subsetApplied);
    } catch (error: any) {
      toast({ title: "Merge failed", description: error?.message ?? "Unknown error", variant: "destructive" });
      setPending(false);
      setShowMerge(false);
    }
  }

  async function createEventFamily(name: string) {
    if (!selectionReady) return;
    setPending(true);
    try {
      await apiPost("/event-families", {
        name,
        organizationIds: sourceOrgIds,
      });
      toast({ title: `Created Event Family: ${name}` });
      setShowEventFamily(false);
      onResolved(subsetApplied);
    } catch (error: any) {
      toast({ title: "Could not create Event Family", description: error?.message ?? "Unknown error", variant: "destructive" });
      setPending(false);
    }
  }

  async function notRelated() {
    if (!selectionReady) return;
    setPending(true);
    try {
      await apiPost("/organizations/family-review", {
        action: "not_related",
        candidateIds: [...sourceOrgIds].sort((left, right) => left.localeCompare(right, "en-US")),
      });
      toast({ title: "Selected profiles marked as not related" });
      onResolved(subsetApplied);
    } catch (error: any) {
      toast({ title: "Review failed", description: error?.message ?? "Unknown error", variant: "destructive" });
      setPending(false);
    }
  }

  return (
    <>
      {showMerge ? <MergeDialog group={selectedGroup} merging={pending} onCancel={() => setShowMerge(false)} onConfirm={merge} primaryId={primaryId} /> : null}
      {showEventFamily ? (
        <EventFamilyDialog
          group={selectedGroup}
          onCancel={() => setShowEventFamily(false)}
          onConfirm={createEventFamily}
          pending={pending}
        />
      ) : null}
      {showConsolidate ? (
        <ConsolidationDialog
          onCancel={() => setShowConsolidate(false)}
          onComplete={() => onResolved(subsetApplied)}
          sourceOrgIds={sourceOrgIds}
          sourceOrgNames={sourceOrgNames}
        />
      ) : null}
      <div className={`rounded-xl border p-4 ${locationCandidate ? "border-sky-200 bg-sky-50" : "border-amber-200 bg-amber-50"}`} data-testid={`duplicate-group-${group.groupKey ?? group.normalizedName}`}>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={`text-sm font-bold ${locationCandidate ? "text-sky-900" : "text-amber-800"}`}>
              Group {index + 1} -- {group.organizations.length} matching profiles
            </p>
            <p className="mt-1 text-xs font-bold text-slate-700">{selectedCount} of {group.organizations.length} selected</p>
            {locationCandidate ? (
              <>
                <p className="mt-1 text-sm text-sky-900">
                  {group.classification === "ambiguous_location_candidate"
                    ? "Possible relationship -- select only the profiles that actually belong together, then choose what they mean."
                    : "Select the profiles that belong together, then choose Profile Locations or Event Family."}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {(group.evidence ?? []).map((item) => (
                    <li className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-sky-800" key={item.family}>{evidenceLabel(item)}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="button-secondary text-sm"
              disabled={disabled || pending || !selectionReady || !mergePrimaryReady}
              onClick={() => setShowMerge(true)}
              title="Same profile entered more than once: keep the chosen primary and combine the selected copies"
            >
              Merge selected duplicates
            </button>
            {locationCandidate ? (
              <>
                <button
                  className="button-primary text-sm"
                  disabled={disabled || pending || !selectionReady}
                  onClick={() => setShowConsolidate(true)}
                  title="One profile with multiple venues or addresses"
                >
                  Combine as Profile Locations
                </button>
                <button
                  className="button-secondary text-sm"
                  disabled={disabled || pending || !selectionReady}
                  onClick={() => setShowEventFamily(true)}
                  title="Related profiles that should keep separate history"
                >
                  Group as Event Family
                </button>
                <button className="button-secondary text-sm" disabled={disabled || pending || !selectionReady} onClick={notRelated}>Not related</button>
              </>
            ) : null}
          </div>
        </div>
        {locationCandidate ? <RelationshipChoiceGuide /> : null}
        {!selectionReady ? <p className="mb-3 rounded-lg bg-white p-2 text-sm font-semibold text-amber-800">Select at least two profiles for a relationship or merge action.</p> : null}
        {selectionReady && !mergePrimaryReady ? <p className="mb-3 rounded-lg bg-white p-2 text-sm text-slate-600">To merge the selected profiles as true duplicates, choose which selected profile should be Primary.</p> : null}
        <LocationList
          disabled={disabled || pending}
          group={group}
          onPrimaryChange={onPrimaryChange}
          onSelectionChange={changeSelection}
          primaryId={primaryId}
          selectedIds={selectedIds}
        />
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

  async function resolved(group: DuplicateGroup, subsetApplied: boolean) {
    if (!subsetApplied) {
      setLocalGroups((current) => current.filter((item) => identity(item) !== identity(group)));
    }
    const refreshed = await onRefresh();
    if (refreshed) {
      setLocalGroups(refreshed);
      setPrimaryIds((current) => reconcilePrimaryIds(current, refreshed));
    }
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
        <p className="text-lg font-semibold text-slate-700">No unresolved duplicate profiles found</p>
        <p className="mt-1 text-sm text-slate-500">Merged profiles, Profile Locations, and Event Family members stay out of this cleanup list.</p>
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
            <p className="mt-0.5 text-sm text-slate-600">Related-profile candidates are excluded until you review what they mean.</p>
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
          onResolved={(subsetApplied) => { void resolved(group, subsetApplied); }}
          primaryId={primaryIds[identity(group)] ?? ""}
        />
      ))}
    </div>
  );
}
