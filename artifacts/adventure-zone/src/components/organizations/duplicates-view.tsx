import { useState } from "react";
import type { OrganizationListRecord } from "@/features/organizations/organization-repository";
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

function MergeDialog({ group, primaryId, onConfirm, onCancel, merging }: MergeDialogProps) {
  const primary = group.organizations.find((o) => o.id === primaryId);
  const dupCount = group.organizations.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold">Confirm merge</h2>
        <p className="mt-3 text-slate-700">
          Keep <span className="font-semibold">{primary?.name}</span> and delete{" "}
          {dupCount} duplicate{dupCount !== 1 ? "s" : ""}? All contacts and bookings will
          be moved to the primary record.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            className="button-primary flex-1"
            disabled={merging}
            onClick={onConfirm}
          >
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

function DuplicateGroupCard({
  group,
  index,
  onMerged,
}: {
  group: DuplicateGroup;
  index: number;
  onMerged: () => void;
}) {
  const [primaryId, setPrimaryId] = useState(group.organizations[0]?.id ?? "");
  const [showDialog, setShowDialog] = useState(false);
  const [merging, setMerging] = useState(false);
  const { toast } = useToast();

  async function handleMerge() {
    setMerging(true);
    const duplicateIds = group.organizations
      .filter((o) => o.id !== primaryId)
      .map((o) => o.id);
    try {
      await apiPost("/organizations/merge", { primaryId, duplicateIds });
      const primary = group.organizations.find((o) => o.id === primaryId);
      toast({
        title: `Merged ${duplicateIds.length} duplicate${duplicateIds.length !== 1 ? "s" : ""} into ${primary?.name ?? "primary"}`,
      });
      setShowDialog(false);
      onMerged();
    } catch (err: any) {
      toast({ title: "Merge failed", description: err?.message ?? "Unknown error", variant: "destructive" });
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
            disabled={merging}
            onClick={() => setShowDialog(true)}
          >
            Merge into primary
          </button>
        </div>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Choose the record to keep as primary
          </legend>
          <ul className="grid gap-2">
            {group.organizations.map((org) => {
              const isPrimary = org.id === primaryId;
              return (
                <li key={org.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      isPrimary
                        ? "border-orange-300 bg-white shadow-sm"
                        : "border-slate-200 bg-white/60 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`primary-${group.normalizedName}-${group.city}`}
                      value={org.id}
                      checked={isPrimary}
                      onChange={() => setPrimaryId(org.id)}
                      className="mt-0.5 accent-orange-600"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">{org.name}</p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {[org.city, org.region].filter(Boolean).join(", ")}
                        {org.primaryContactName ? (
                          <span className="ml-2 font-medium text-slate-700">
                            · {org.primaryContactName}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {org.contactCount} contact{org.contactCount !== 1 ? "s" : ""} ·{" "}
                        {org.bookingCount} booking{org.bookingCount !== 1 ? "s" : ""}
                      </p>
                      {org.lastResort ? (
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

export function DuplicatesView({
  groups,
  onRefresh,
}: {
  groups: DuplicateGroup[];
  onRefresh: () => void;
}) {
  const [localGroups, setLocalGroups] = useState(groups);

  if (!localGroups.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-lg font-semibold text-slate-700">No duplicate profiles found</p>
        <p className="mt-1 text-sm text-slate-500">
          All place profiles have unique names within each city.
        </p>
      </div>
    );
  }

  function handleMerged(groupIndex: number) {
    setLocalGroups((prev) => prev.filter((_, i) => i !== groupIndex));
    onRefresh();
  }

  return (
    <div className="grid gap-4">
      {localGroups.map((group, index) => (
        <DuplicateGroupCard
          key={`${group.normalizedName}-${group.city}-${group.region}`}
          group={group}
          index={index}
          onMerged={() => handleMerged(index)}
        />
      ))}
    </div>
  );
}
