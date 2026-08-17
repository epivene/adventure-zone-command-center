"use client";

import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { BookingPackageResourceEditorModel } from "@/features/bookings/booking-repository";
import { getAttractionTotalPolicy } from "@/features/packages/package-policy";
import type { ConfigureBookingPackagesInput } from "@/features/packages/package-input";
import type { PackageCountCategory } from "@/features/resources/resource-input";

type ActionResult = { ok: true } | { ok: false; error: string };
type ConfigureResourcesInput = { bookingId: string; resourceIds: string[] };

type EnrichedPackage = BookingPackageResourceEditorModel["packageOptions"][number] & {
  minimumAttractionCount?: number;
  maximumAttractionCount?: number;
};
type EnrichedResource = BookingPackageResourceEditorModel["resourceOptions"][number] & {
  packageCountCategory?: PackageCountCategory;
};

function plainCategoryLabel(category: PackageCountCategory) {
  if (category === "game_extra") return "Carnival games / extras";
  if (category === "special_shared") return "Special / shared equipment";
  return "Main attractions";
}

export function PackageResourceEditor({
  model,
  configurePackages,
  configureResources,
}: {
  model: BookingPackageResourceEditorModel;
  configurePackages: (
    input: ConfigureBookingPackagesInput,
  ) => Promise<ActionResult>;
  configureResources: (
    input: ConfigureResourcesInput,
  ) => Promise<ActionResult>;
}) {
  const packages = model.packageOptions as EnrichedPackage[];
  const resources = model.resourceOptions as EnrichedResource[];
  const [selectedPackages, setSelectedPackages] = useState(
    () => new Set(packages.filter(({ selected }) => selected).map(({ id }) => id)),
  );
  const [selectedResources, setSelectedResources] = useState(
    () => new Set(resources.filter(({ assigned }) => assigned).map(({ id }) => id)),
  );
  const [total, setTotal] = useState(
    model.physicalAttractionTotal?.toString() ?? "",
  );
  const [manualAttributions, setManualAttributions] = useState<
    Map<string, string[] | null>
  >(() =>
    new Map(
      resources.flatMap((resource) =>
        resource.assignmentId
          ? [[
              resource.assignmentId,
              resource.attributionSource === "manual"
                ? [...resource.attributedPackageIds]
                : null,
            ] as const]
          : [],
      ),
    )
  );
  const [packageError, setPackageError] = useState("");
  const [packageStatus, setPackageStatus] = useState("");
  const [resourceError, setResourceError] = useState("");
  const [resourceStatus, setResourceStatus] = useState("");
  const [savingPackages, setSavingPackages] = useState(false);
  const [savingResources, setSavingResources] = useState(false);
  const packageErrorRef = useRef<HTMLParagraphElement>(null);
  const resourceErrorRef = useRef<HTMLParagraphElement>(null);

  const selectedPackageRecords = useMemo(
    () => packages.filter(({ id }) => selectedPackages.has(id)),
    [packages, selectedPackages],
  );
  const policy = getAttractionTotalPolicy(selectedPackageRecords);
  const assignedSelectedResources = resources.filter((resource) =>
    selectedResources.has(resource.id)
  );
  const categoryCounts = assignedSelectedResources.reduce(
    (counts, resource) => {
      const category = resource.packageCountCategory ?? "main_attraction";
      counts[category] += 1;
      return counts;
    },
    { main_attraction: 0, game_extra: 0, special_shared: 0 } as Record<PackageCountCategory, number>,
  );

  function toggleSet(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
    checked: boolean,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  }

  function togglePackage(value: string, checked: boolean) {
    setPackageStatus("");
    toggleSet(setSelectedPackages, value, checked);
    if (!checked) {
      setManualAttributions((current) =>
        new Map(
          [...current].map(([assignmentId, packageIds]) => [
            assignmentId,
            packageIds?.filter((packageId) => packageId !== value) ?? null,
          ]),
        )
      );
    }
  }

  function displayedPackageIds(resource: EnrichedResource): string[] {
    if (!resource.assignmentId) {
      return resource.packageTemplateIds.filter((id) => selectedPackages.has(id));
    }
    const manual = manualAttributions.get(resource.assignmentId);
    return manual === null || manual === undefined
      ? resource.packageTemplateIds.filter((id) => selectedPackages.has(id))
      : manual;
  }

  async function submitPackages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPackages) return;
    setPackageError("");
    setPackageStatus("");
    setSavingPackages(true);
    try {
      const result = await configurePackages({
        bookingId: model.bookingId,
        packageTemplateIds: packages
          .map(({ id }) => id)
          .filter((id) => selectedPackages.has(id)),
        physicalAttractionTotal:
          total === "" || !Number.isFinite(Number(total)) ? null : Number(total),
        // Legacy field remains in the API contract, but package-guideline deviations no longer require it.
        attractionTotalApprovalReason: null,
        manualAttributions: resources.flatMap((resource) =>
          resource.assignmentId
            ? [{
                bookingResourceAssignmentId: resource.assignmentId,
                packageTemplateIds:
                  manualAttributions.get(resource.assignmentId) ?? null,
              }]
            : [],
        ),
      });
      if (!result.ok) {
        setPackageError(result.error);
        requestAnimationFrame(() => packageErrorRef.current?.focus());
      } else {
        setPackageStatus("Package setup saved.");
      }
    } catch {
      setPackageError("Could not save package setup. Please try again.");
      requestAnimationFrame(() => packageErrorRef.current?.focus());
    } finally {
      setSavingPackages(false);
    }
  }

  async function submitResources(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingResources) return;
    setResourceError("");
    setResourceStatus("");
    setSavingResources(true);
    try {
      const result = await configureResources({
        bookingId: model.bookingId,
        resourceIds: resources
          .map(({ id }) => id)
          .filter((id) => selectedResources.has(id)),
      });
      if (!result.ok) {
        setResourceError(result.error);
        requestAnimationFrame(() => resourceErrorRef.current?.focus());
      } else {
        setResourceStatus("Resource assignments saved.");
      }
    } catch {
      setResourceError("Could not save resource assignments. Please try again.");
      requestAnimationFrame(() => resourceErrorRef.current?.focus());
    } finally {
      setSavingResources(false);
    }
  }

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
        onSubmit={submitPackages}
      >
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">
            Package setup
          </p>
          <h2 className="mt-1 text-xl font-bold">
            {selectedPackages.size} {selectedPackages.size === 1 ? "package" : "packages"} · {total || "No"} physical attractions
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Package ranges are normal guidelines, not limits. Custom family-business deals can go above or below them.
          </p>
        </div>

        {packageError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" ref={packageErrorRef} role="alert" tabIndex={-1}>
            {packageError}
          </p>
        ) : null}
        {packageStatus ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">
            {packageStatus}
          </p>
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="font-semibold">Packages sold for this event</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((option) => (
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3" key={option.id}>
                <input
                  checked={selectedPackages.has(option.id)}
                  onChange={(event) => togglePackage(option.id, event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="font-semibold">{option.name}</span>
                  {!option.active ? " (inactive)" : ""}
                  <span className="block text-sm text-slate-500">
                    Normal {option.minimumAttractionCount ?? option.baseAttractionCount}–{option.maximumAttractionCount ?? option.baseAttractionCount} main attractions
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {selectedPackageRecords.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {selectedPackageRecords.map((pkg) => {
              const attributedMain = assignedSelectedResources.filter(
                (resource) =>
                  (resource.packageCountCategory ?? "main_attraction") === "main_attraction" &&
                  displayedPackageIds(resource).includes(pkg.id),
              );
              const minimum = pkg.minimumAttractionCount ?? pkg.baseAttractionCount;
              const maximum = pkg.maximumAttractionCount ?? pkg.baseAttractionCount;
              const unusual = attributedMain.length > 0 &&
                (attributedMain.length < minimum || attributedMain.length > maximum);
              return (
                <section className="rounded-xl border border-slate-200 p-4" key={pkg.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold">{pkg.name}</h3>
                    <span className="text-sm font-semibold">
                      {attributedMain.length} assigned · normal {minimum}–{maximum}
                    </span>
                  </div>
                  {unusual ? (
                    <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                      This is outside the normal range. That is allowed—just confirm the event and leg have the equipment/capacity you intend.
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm text-slate-600">
                    {attributedMain.length > 0
                      ? attributedMain.map((resource) => resource.name).join(", ")
                      : "No specific main attractions assigned to this package yet."}
                  </p>
                </section>
              );
            })}
          </div>
        ) : null}

        <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
          {(["main_attraction", "game_extra", "special_shared"] as const).map((category) => (
            <div key={category}>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{plainCategoryLabel(category)}</p>
              <p className="mt-1 text-2xl font-bold">{categoryCounts[category]}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 sm:max-w-sm">
          <p className="text-sm text-slate-600">
            {policy.suggested === null
              ? "Select a package to see the combined guideline."
              : `Combined package guide: suggested ${policy.suggested} · normal ${policy.minimum}–${policy.maximum}`}
          </p>
          <label className="grid gap-1.5 font-medium">
            Physical attraction total
            <input
              min="0"
              onChange={(event) => {
                setPackageStatus("");
                setTotal(event.target.value);
              }}
              required={selectedPackages.size > 0}
              type="number"
              value={total}
            />
          </label>
        </div>

        {resources
          .filter(({ assignmentId }) => assignmentId)
          .map((resource) => {
            const assignmentId = resource.assignmentId!;
            const manual = manualAttributions.get(assignmentId);
            const displayedIds = displayedPackageIds(resource);
            const names = displayedIds
              .map((id) => packages.find((option) => option.id === id)?.name)
              .filter((name): name is string => Boolean(name));
            return (
              <fieldset className="grid gap-2 rounded-lg border border-slate-200 p-3" key={assignmentId}>
                <legend className="px-1 font-semibold">{resource.name} attribution</legend>
                <p className="text-sm text-slate-600">
                  {manual === null || manual === undefined ? "Inferred" : "Manual"}: {names.join(", ") || "no packages"}
                </p>
                <div className="flex flex-wrap gap-4">
                  <label className="flex gap-2">
                    <input
                      checked={manual === null || manual === undefined}
                      name={`attribution-source-${assignmentId}`}
                      onChange={() => setManualAttributions((current) => new Map(current).set(assignmentId, null))}
                      type="radio"
                    />
                    Infer from resource tags
                  </label>
                  <label className="flex gap-2">
                    <input
                      checked={manual !== null && manual !== undefined}
                      name={`attribution-source-${assignmentId}`}
                      onChange={() =>
                        setManualAttributions((current) =>
                          new Map(current).set(
                            assignmentId,
                            resource.packageTemplateIds.filter((id) => selectedPackages.has(id)),
                          )
                        )
                      }
                      type="radio"
                    />
                    Choose manually
                  </label>
                </div>
                {manual !== null && manual !== undefined ? (
                  <div className="grid gap-1 pl-5 sm:grid-cols-2">
                    {selectedPackageRecords.map((option) => (
                      <label className="flex gap-2" key={option.id}>
                        <input
                          checked={manual.includes(option.id)}
                          onChange={(event) => {
                            setManualAttributions((current) => {
                              const next = new Map(current);
                              const selected = new Set(next.get(assignmentId) ?? []);
                              if (event.target.checked) selected.add(option.id);
                              else selected.delete(option.id);
                              next.set(assignmentId, [...selected]);
                              return next;
                            });
                          }}
                          type="checkbox"
                        />
                        {option.name}
                      </label>
                    ))}
                  </div>
                ) : null}
              </fieldset>
            );
          })}

        <button className="button-primary justify-self-start" disabled={savingPackages} type="submit">
          {savingPackages ? "Saving…" : "Save package setup"}
        </button>
      </form>

      <form className="grid content-start gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" onSubmit={submitResources}>
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">Resource assignments</p>
          <h2 className="mt-1 text-xl font-bold">{selectedResources.size} physical resources selected</h2>
          <p className="mt-1 text-sm text-slate-600">
            A physical resource appears once here even when it supports more than one package.
          </p>
        </div>
        {resourceError ? <p ref={resourceErrorRef} role="alert" tabIndex={-1}>{resourceError}</p> : null}
        {resourceStatus ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{resourceStatus}</p> : null}
        <fieldset className="grid gap-2">
          <legend className="font-semibold">Equipment / attractions</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((resource) => (
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3" key={resource.id}>
                <input
                  checked={selectedResources.has(resource.id)}
                  onChange={(event) => {
                    setResourceStatus("");
                    toggleSet(setSelectedResources, resource.id, event.target.checked);
                  }}
                  type="checkbox"
                />
                <span className="grid">
                  <span className="font-semibold">{resource.name}{resource.status !== "available" ? ` (${resource.status})` : ""}</span>
                  <span className="text-xs text-slate-500">{plainCategoryLabel(resource.packageCountCategory ?? "main_attraction")}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="button-primary justify-self-start" disabled={savingResources} type="submit">
          {savingResources ? "Saving…" : "Save resource assignments"}
        </button>
      </form>
    </div>
  );
}
