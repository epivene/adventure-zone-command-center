import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/auth-token";
import { useToast } from "@workspace/avz-crm/hooks/use-toast";
import type { OrganizationListRecord } from "@/features/organizations/organization-repository";

//  Types

type LocationProposal = {
  sourceOrgId: string;
  sourceOrgName: string;
  proposedLabel: string;
  city: string | null;
  region: string | null;
  alreadyConsolidated: boolean;
  recordCounts: {
    contacts: number;
    bookings: number;
    activities: number;
    followUps: number;
  };
};

type ConsolidationPreview = {
  canonical: { id: string | null; name: string };
  locationProposals: LocationProposal[];
  generalHistoryCounts: LocationProposal["recordCounts"];
};

type CanonicalMode = "new" | "existing";

//  Step 1 -- Canonical picker

function CanonicalStep({
  sourceOrgIds,
  onNext,
  onCancel,
}: {
  sourceOrgIds: string[];
  onNext: (canonical: { mode: CanonicalMode; id: string | null; name: string; website?: string; phone?: string }) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<CanonicalMode>("new");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [existingId, setExistingId] = useState("");
  const [eligibleOrgs, setEligibleOrgs] = useState<OrganizationListRecord[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const records: OrganizationListRecord[] = [];
        let page = 1;
        let pageCount = 1;
        do {
          const resp = await apiGet<{ organizations: { records: OrganizationListRecord[]; pageCount: number } }>(
            `/organizations?page=${page}`,
          );
          records.push(...resp.organizations.records);
          pageCount = resp.organizations.pageCount;
          page++;
        } while (page <= pageCount);
        if (!cancelled) {
          const excludeSet = new Set(sourceOrgIds);
          setEligibleOrgs(records.filter((r) => !excludeSet.has(r.id)));
          setLoadingOrgs(false);
        }
      } catch {
        if (!cancelled) setLoadingOrgs(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [sourceOrgIds]);

  function proceed() {
    if (mode === "new") {
      if (!name.trim()) return;
      onNext({ mode: "new", id: null, name: name.trim(), website: website.trim() || undefined, phone: phone.trim() || undefined });
    } else {
      if (!existingId) return;
      const org = eligibleOrgs.find((o) => o.id === existingId);
      onNext({ mode: "existing", id: existingId, name: org?.name ?? "" });
    }
  }

  const canProceed = mode === "new" ? !!name.trim() : !!existingId;

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="font-semibold text-slate-900">Step 1 -- Choose the canonical organization</h3>
        <p className="mt-1 text-sm text-slate-600">
          This is the one organization profile that will contain all possible locations.
        </p>
      </div>
      <div className="flex gap-4 text-sm font-semibold">
        <label>
          <input checked={mode === "new"} className="mr-2" name="canonical-mode" onChange={() => setMode("new")} type="radio" />
          Create new organization
        </label>
        <label>
          <input checked={mode === "existing"} className="mr-2" name="canonical-mode" onChange={() => setMode("existing")} type="radio" />
          Use existing
        </label>
      </div>

      {mode === "new" ? (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold">
            Organization name <span className="text-rose-600">*</span>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Midwest State Fair"
              value={name}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Website (optional)
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://..."
              value={website}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Phone (optional)
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
              onChange={(e) => setPhone(e.target.value)}
              value={phone}
            />
          </label>
        </div>
      ) : (
        <label className="grid gap-1 text-sm font-semibold">
          Existing organization
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
            disabled={loadingOrgs}
            onChange={(e) => setExistingId(e.target.value)}
            value={existingId}
          >
            <option value="">{loadingOrgs ? "Loading…" : "Choose an organization"}</option>
            {eligibleOrgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="flex gap-3 pt-2">
        <button className="button-primary flex-1" disabled={!canProceed} onClick={proceed}>
          Next -- Set location labels
        </button>
        <button className="button-secondary flex-1" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

//  Step 2 -- Preview & label editor

function PreviewStep({
  canonical,
  preview,
  onConfirm,
  onBack,
}: {
  canonical: { mode: CanonicalMode; id: string | null; name: string; website?: string; phone?: string };
  preview: ConsolidationPreview;
  onConfirm: (labels: Record<string, string>) => void;
  onBack: () => void;
}) {
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(preview.locationProposals.map((p) => [p.sourceOrgId, p.proposedLabel])),
  );

  const allLabeled = preview.locationProposals
    .filter((p) => !p.alreadyConsolidated)
    .every((p) => labels[p.sourceOrgId]?.trim());

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="font-semibold text-slate-900">Step 2 -- Review locations</h3>
        <p className="mt-1 text-sm text-slate-600">
          Each source profile becomes a named internal location in{" "}
          <span className="font-semibold">{preview.canonical.name}</span>. Adjust labels as needed.
        </p>
      </div>

      <div className="grid gap-3">
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <p className="font-semibold text-slate-900">General organization history</p>
          <p className="mt-1 text-xs text-slate-600">
            Existing organization-wide records stay here: {preview.generalHistoryCounts.contacts} contacts, {preview.generalHistoryCounts.bookings} bookings, {preview.generalHistoryCounts.activities} activities, and {preview.generalHistoryCounts.followUps} follow-ups.
          </p>
        </div>
        {preview.locationProposals.map((proposal) => (
          <div
            key={proposal.sourceOrgId}
            className={`rounded-xl border p-4 ${
              proposal.alreadyConsolidated
                ? "border-green-200 bg-green-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">{proposal.sourceOrgName}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {[proposal.city, proposal.region].filter(Boolean).join(", ") || "No location data"}
                </p>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
                  {proposal.recordCounts.contacts > 0 && (
                    <span>{proposal.recordCounts.contacts} contact{proposal.recordCounts.contacts !== 1 ? "s" : ""}</span>
                  )}
                  {proposal.recordCounts.bookings > 0 && (
                    <span>{proposal.recordCounts.bookings} booking{proposal.recordCounts.bookings !== 1 ? "s" : ""}</span>
                  )}
                  {proposal.recordCounts.activities > 0 && (
                    <span>{proposal.recordCounts.activities} activit{proposal.recordCounts.activities !== 1 ? "ies" : "y"}</span>
                  )}
                  {proposal.recordCounts.followUps > 0 && (
                    <span>{proposal.recordCounts.followUps} follow-up{proposal.recordCounts.followUps !== 1 ? "s" : ""}</span>
                  )}
                  {Object.values(proposal.recordCounts).every((n) => n === 0) && (
                    <span className="text-slate-400">No linked records</span>
                  )}
                </div>
              </div>
              {proposal.alreadyConsolidated ? (
                <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-700">
                  Already consolidated
                </span>
              ) : null}
            </div>
            {!proposal.alreadyConsolidated && (
              <label className="mt-3 grid gap-1 text-sm font-semibold">
                Location label
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  onChange={(e) =>
                    setLabels((prev) => ({ ...prev, [proposal.sourceOrgId]: e.target.value }))
                  }
                  placeholder={proposal.proposedLabel}
                  value={labels[proposal.sourceOrgId] ?? ""}
                />
              </label>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-3 pt-2">
        <button className="button-primary flex-1" disabled={!allLabeled} onClick={() => onConfirm(labels)}>
          Consolidate {preview.locationProposals.filter((p) => !p.alreadyConsolidated).length} profile
          {preview.locationProposals.filter((p) => !p.alreadyConsolidated).length !== 1 ? "s" : ""}
        </button>
        <button className="button-secondary flex-1" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

//  Main dialog

type ConsolidationDialogProps = {
  sourceOrgIds: string[];
  sourceOrgNames: string[];
  onCancel: () => void;
  onComplete: () => void;
};

type DialogStep = "canonical" | "preview" | "applying";

export function ConsolidationDialog({
  sourceOrgIds,
  sourceOrgNames,
  onCancel,
  onComplete,
}: ConsolidationDialogProps) {
  const [step, setStep] = useState<DialogStep>("canonical");
  const [canonical, setCanonical] = useState<{
    mode: CanonicalMode;
    id: string | null;
    name: string;
    website?: string;
    phone?: string;
  } | null>(null);
  const [preview, setPreview] = useState<ConsolidationPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const { toast } = useToast();

  async function handleCanonicalNext(chosenCanonical: typeof canonical) {
    if (!chosenCanonical) return;
    setCanonical(chosenCanonical);
    setLoadingPreview(true);
    setPreviewError(null);
    setStep("preview");
    try {
      const resp = await apiPost<{ ok: boolean; preview: ConsolidationPreview }>(
        "/organizations/consolidation-preview",
        {
          canonicalOrgId: chosenCanonical.id,
          proposedCanonicalName: chosenCanonical.id ? undefined : chosenCanonical.name,
          sourceOrgIds,
        },
      );
      setPreview(resp.preview);
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Could not load preview.");
      setStep("canonical");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleConfirm(labels: Record<string, string>) {
    if (!canonical || !preview) return;
    setApplying(true);
    setApplyError(null);
    try {
      await apiPost("/organizations/consolidation-apply", {
        canonicalOrgId: canonical.id,
        proposedCanonical: canonical.id
          ? undefined
          : {
              name: canonical.name,
              website: canonical.website ?? null,
              phone: canonical.phone ?? null,
            },
        locationAssignments: preview.locationProposals
          .filter((p) => !p.alreadyConsolidated)
          .map((p) => ({
            sourceOrgId: p.sourceOrgId,
            label: labels[p.sourceOrgId] ?? p.proposedLabel,
          })),
      });
      toast({ title: "Organizations consolidated successfully" });
      onComplete();
    } catch (err: unknown) {
      setApplyError(err instanceof Error ? err.message : "Could not apply consolidation.");
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div
        aria-label="Consolidate as locations"
        aria-modal="true"
        className="my-8 w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        role="dialog"
      >
        <div className="mb-4">
          <h2 className="text-lg font-bold">Consolidate as locations</h2>
          <p className="mt-1 text-sm text-slate-600">
            Combining <span className="font-semibold">{sourceOrgNames.length} profiles</span> into
            one organization with location records. Contacts, bookings, and history stay grouped by
            their source location.
          </p>
        </div>

        {previewError && (
          <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">
            {previewError}
          </p>
        )}
        {applyError && (
          <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">
            {applyError}
          </p>
        )}

        {(step === "canonical" || (step === "preview" && loadingPreview)) && !applying ? (
          <CanonicalStep
            onCancel={onCancel}
            onNext={handleCanonicalNext}
            sourceOrgIds={sourceOrgIds}
          />
        ) : step === "preview" && preview && !applying ? (
          <PreviewStep
            canonical={canonical!}
            onBack={() => setStep("canonical")}
            onConfirm={handleConfirm}
            preview={preview}
          />
        ) : (
          <div className="py-8 text-center">
            <p className="font-semibold text-slate-700">
              {loadingPreview ? "Loading preview…" : "Applying consolidation…"}
            </p>
            <p className="mt-1 text-sm text-slate-500">This may take a moment.</p>
          </div>
        )}
      </div>
    </div>
  );
}
