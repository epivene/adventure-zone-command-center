import { useEffect, useState } from "react";
import type { OrganizationListRecord } from "@/features/organizations/organization-repository";
import {
  BulkDuplicateMergeError,
  mergeDuplicateGroups,
} from "@/features/organizations/bulk-duplicate-merge";
import { apiPost } from "@/lib/auth-token";
import { useToast } from "@/hooks/use-toast";

export type DuplicateGroup = {
  normalizedName: string;
  city: string;
  region: string;
  organizations: OrganizationListRecord[];
};

type MergeDialogProps = {
  group: DuplicateGroup;
  primaryId: string;
  onConfirm: () => void;
  onCancel: () => void;
  merging: boolean;
};

function MergeDialog({
  group,
  primaryId,
  onConfirm,
  onCancel,
  merging,
}: MergeDialogProps) {
  const primary = group.organizations.find(
    (organization) => organization.id === primaryId,
  );
  const duplicateCount = group.organizations.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold">Confirm merge</h2>
        <p className="mt-3 text-slate-700">
          Keep <span className="font-semibold">{primary?.name}</span> and delete{" "}
          {duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""}? All
          contacts and bookings will be moved to the primary record.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            className="button-primary flex-1"
            disabled={merging}
            onClick={onConfirm}
          >
            {merging ? "Merging…" : "Confirm"}
          </button>
          <button
            className="button-secondary flex-1"
            disabled={merging}
            onClick={onCancel}
          >
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
      <div
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        role="dialog"
      >
        <h2 className="text-lg font-bold">Merge all duplicate profiles?</h2>
        <p className="mt-3 text-slate-700">
          This will merge {groupCount} duplicate group
          {groupCount !== 1 ? "s" : ""} into each marked Primary. Linked
          contacts, bookings, follow-ups, activities, history, and ACT links
          will move to the primary before redundant profiles are removed.
        </p>
        <p className="mt-3 text-sm font-semibold text-amber-800">
          This cannot be undone.
        </p>
        <div className="mt-6 flex gap-3">
          <button className="button-primary flex-1" onClick={onConfirm}>
            Merge all {groupCount} group{groupCount !== 1 ? "s" : ""}
          </button>
          <button className="button-secondary flex-1" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateGroupCard({
  group,
  index,
  primaryId,
  onPrimaryChange,
  onMerged,
  disabled,
}: {
  group: DuplicateGroup;
  index: number;
  primaryId: string;
  onPrimaryChange: (primaryId: string) => void;
  onMerged: () => void;
  disabled: boolean;
}) {
  const [showDialog, setShowDialog] = useState(false);
  const [merging, setMerging] = useState(false);
  const { toast } = useToast();

  async function handleMerge() {
    setMerging(true);
    const duplicateIds = group.organizations
      .filter((organization) => organization.id !== primaryId)
      .map((organization) => organization.id);
    try {
      await apiPost("/organizations/merge", { primaryId, duplicateIds });
      const primary = group.organizations.find(
        (organization) => organization.id === primaryId,
      );
      toast({
        title: `Merged ${duplicateIds.length} duplicate${duplicateIds.length !== 1 ? "s" : ""} into ${primary?.name ?? "primary"}`,
      });
      setShowDialog(false);
      onMerged();
    } catch (error: any) {
      toast({
        title: "Merge failed",
        description: error?.message ?? "Unknown error",
        variant: "destructive",
      });
      setMerging(false);
      setShowDialog(false);
    }
  }

  return (
    <>
      {showDialog && (
        <MergeDialog
          group={group}
          primaryId={primaryId}
          onConfirm={handleMerge}
          onCancel={() => setShowDialog(false)}
          merging={merging}
        />
      )}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-amber-800">
            Group {index + 1} — {group.organizations.length} matching records
          </p>
          <button
            className="button-primary text-sm"
            disabled={disabled || merging}
            onClick={() => setShowDialog(true)}
          >
            Merge into primary
          </button>
        </div>

        <fieldset disabled={disabled || merging}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Choose the record to keep as primary
          </legend>
          <ul className="grid gap-2">
            {group.organizations.map((organization) => {
              const isPrimary = organization.id === primaryId;
              return (
                <li key={organization.id}>
                  <label
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                      disabled
                        ? "cursor-not-allowed opacity-70"
                        : "cursor-pointer"
                    } ${
                      isPrimary
                        ? "border-orange-300 bg-white shadow-sm"
                        : "border-slate-200 bg-white/60 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`primary-${group.normalizedName}-${group.city}`}
                      value={organization.id}
                      checked={isPrimary}
                      onChange={() => onPrimaryChange(organization.id)}
                      className="mt-0.5 accent-orange-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">
                        {organization.name}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {[organization.city, organization.region]
                          .filter(Boolean)
                          .join(", ")}
                        {organization.primaryContactName ? (
                          <span className="ml-2 font-medium text-slate-700">
                            · {organization.primaryContactName}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {organization.contactCount} contact
                        {organization.contactCount !== 1 ? "s" : ""} ·{" "}
                        {organization.bookingCount} booking
                        {organization.bookingCount !== 1 ? "s" : ""}
                      </p>
                      {organization.lastResort ? (
                        <span className="mt-1 inline-block rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800">
                          Last Resort
                        </span>
                      ) : null}
                    </div>
                    {isPrimary && (
                      <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700">
                        Primary
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </div>
    </>
  );
}

function initialPrimaryIds(groups: DuplicateGroup[]) {
  return Object.fromEntries(
    groups.map((group) => [
      group.normalizedName,
      group.organizations[0]?.id ?? "",
    ]),
  );
}

export function DuplicatesView({
  groups,
  onRefresh,
}: {
  groups: DuplicateGroup[];
  onRefresh: () => void | Promise<void>;
}) {
  const [localGroups, setLocalGroups] = useState(groups);
  const [primaryIds, setPrimaryIds] = useState<Record<string, string>>(() =>
    initialPrimaryIds(groups),
  );
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [bulkMerging, setBulkMerging] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ completed: 0, total: 0 });
  const [bulkError, setBulkError] = useState<BulkDuplicateMergeError | null>(
    null,
  );
  const { toast } = useToast();

  useEffect(() => {
    setLocalGroups(groups);
    setPrimaryIds((current) =>
      Object.fromEntries(
        groups.map((group) => {
          const selected = current[group.normalizedName];
          const selectedStillExists = group.organizations.some(
            (organization) => organization.id === selected,
          );
          return [
            group.normalizedName,
            selectedStillExists ? selected : (group.organizations[0]?.id ?? ""),
          ];
        }),
      ),
    );
  }, [groups]);

  function handleMerged(groupName: string) {
    setLocalGroups((current) =>
      current.filter((group) => group.normalizedName !== groupName),
    );
    void onRefresh();
  }

  async function runBulkMerge() {
    const pendingGroups = [...localGroups];
    setShowBulkDialog(false);
    setBulkError(null);
    setBulkProgress({ completed: 0, total: pendingGroups.length });
    setBulkMerging(true);

    try {
      await mergeDuplicateGroups(
        pendingGroups,
        primaryIds,
        async (request) => {
          await apiPost("/organizations/merge", request);
        },
        (progress) => {
          setBulkProgress({
            completed: progress.completed,
            total: progress.total,
          });
          setLocalGroups((current) =>
            current.filter(
              (group) => group.normalizedName !== progress.groupName,
            ),
          );
        },
      );
      toast({ title: "All duplicate profiles were merged" });
    } catch (error) {
      const mergeError =
        error instanceof BulkDuplicateMergeError
          ? error
          : new BulkDuplicateMergeError({
              groupName: "unknown group",
              completed: 0,
              total: pendingGroups.length,
              cause: error,
            });
      setBulkError(mergeError);
    } finally {
      setBulkMerging(false);
      void onRefresh();
    }
  }

  if (!localGroups.length && !bulkMerging) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-lg font-semibold text-slate-700">
          No duplicate profiles found
        </p>
        <p className="mt-1 text-sm text-slate-500">
          All place profiles have unique names.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {showBulkDialog && (
        <BulkMergeDialog
          groupCount={localGroups.length}
          onConfirm={runBulkMerge}
          onCancel={() => setShowBulkDialog(false)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
        <div>
          <p className="font-semibold text-slate-900">
            Merge duplicate profiles automatically
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            Each group will be merged into the profile already marked Primary.
          </p>
        </div>
        {bulkMerging ? (
          <p className="font-bold text-orange-700" aria-live="polite">
            Merging {bulkProgress.completed} of {bulkProgress.total}
          </p>
        ) : bulkError ? (
          <button className="button-primary" onClick={runBulkMerge}>
            Resume remaining merges
          </button>
        ) : (
          <button
            className="button-primary"
            onClick={() => setShowBulkDialog(true)}
          >
            Merge all {localGroups.length} group
            {localGroups.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {bulkError && !bulkMerging && (
        <div
          className="rounded-xl border border-rose-200 bg-rose-50 p-4"
          role="alert"
        >
          <p className="font-semibold text-rose-800">
            Could not merge “{bulkError.groupName}”. {bulkError.completed} of{" "}
            {bulkError.total} completed.
          </p>
          <p className="mt-1 text-sm text-rose-700">
            {bulkError.cause instanceof Error
              ? bulkError.cause.message
              : "Unknown error"}
          </p>
        </div>
      )}

      {localGroups.map((group, index) => (
        <DuplicateGroupCard
          key={group.normalizedName}
          group={group}
          index={index}
          primaryId={
            primaryIds[group.normalizedName] ?? group.organizations[0]?.id ?? ""
          }
          onPrimaryChange={(primaryId) =>
            setPrimaryIds((current) => ({
              ...current,
              [group.normalizedName]: primaryId,
            }))
          }
          onMerged={() => handleMerged(group.normalizedName)}
          disabled={bulkMerging}
        />
      ))}
    </div>
  );
}
