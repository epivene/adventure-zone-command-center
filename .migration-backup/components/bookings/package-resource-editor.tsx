"use client";

import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

import type { BookingPackageResourceEditorModel } from "@/features/bookings/booking-repository";
import {
  getAttractionTotalPolicy,
  getSpecialRequestAttractionDelta,
} from "@/features/packages/package-policy";
import type { ConfigureBookingPackagesInput } from "@/features/packages/package-input";

type ActionResult = { ok: true } | { ok: false; error: string };
type ConfigureResourcesInput = { bookingId: string; resourceIds: string[] };

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
  const router = useRouter();
  const [selectedPackages, setSelectedPackages] = useState(
    () => new Set(
      model.packageOptions
        .filter(({ selected }) => selected)
        .map(({ id }) => id),
    ),
  );
  const [selectedResources, setSelectedResources] = useState(
    () => new Set(
      model.resourceOptions
        .filter(({ assigned }) => assigned)
        .map(({ id }) => id),
    ),
  );
  const [total, setTotal] = useState(
    model.physicalAttractionTotal?.toString() ?? "",
  );
  const [approvalReason, setApprovalReason] = useState(
    model.attractionTotalApprovalReason ?? "",
  );
  const [manualAttributions, setManualAttributions] = useState<
    Map<string, string[] | null>
  >(() =>
    new Map(
      model.resourceOptions.flatMap((resource) =>
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
    () => model.packageOptions.filter(({ id }) => selectedPackages.has(id)),
    [model.packageOptions, selectedPackages],
  );
  const approvedRequestDelta = model.specialRequests.reduce(
    (sum, request) =>
      sum + getSpecialRequestAttractionDelta(request),
    0,
  );
  const policy = getAttractionTotalPolicy(selectedPackageRecords);
  const suggested = policy.suggested === null
    ? null
    : policy.suggested + approvedRequestDelta;
  const numericTotal = total === "" ? null : Number(total);
  const outOfRange =
    numericTotal !== null &&
    policy.minimum !== null &&
    policy.maximum !== null &&
    (numericTotal < policy.minimum ||
      numericTotal > policy.maximum);

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

  async function submitPackages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingPackages) return;
    setPackageError("");
    setPackageStatus("");
    setSavingPackages(true);
    try {
      const result = await configurePackages({
        bookingId: model.bookingId,
        packageTemplateIds: model.packageOptions
          .map(({ id }) => id)
          .filter((id) => selectedPackages.has(id)),
        physicalAttractionTotal:
          total === "" || !Number.isFinite(Number(total))
            ? null
            : Number(total),
        attractionTotalApprovalReason: approvalReason.trim() || null,
        manualAttributions: model.resourceOptions.flatMap((resource) =>
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
        router.refresh();
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
        resourceIds: model.resourceOptions
          .map(({ id }) => id)
          .filter((id) => selectedResources.has(id)),
      });
      if (!result.ok) {
        setResourceError(result.error);
        requestAnimationFrame(() => resourceErrorRef.current?.focus());
      } else {
        setResourceStatus("Resource assignments saved.");
        router.refresh();
      }
    } catch {
      setResourceError("Could not save resource assignments. Please try again.");
      requestAnimationFrame(() => resourceErrorRef.current?.focus());
    } finally {
      setSavingResources(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <form
        className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
        onSubmit={submitPackages}
      >
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">
            Package setup
          </p>
          <h2 className="mt-1 text-xl font-bold">
            {selectedPackages.size} {selectedPackages.size === 1 ? "package" : "packages"} ·{" "}
            {total || "No"} attractions
          </h2>
        </div>
        {packageError ? (
          <p
            className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
            ref={packageErrorRef}
            role="alert"
            tabIndex={-1}
          >
            {packageError}
          </p>
        ) : null}
        {packageStatus ? (
          <p
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"
            role="status"
          >
            {packageStatus}
          </p>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="font-semibold">Packages</legend>
          {model.packageOptions.map((option) => (
            <label className="flex items-start gap-2" key={option.id}>
              <input
                checked={selectedPackages.has(option.id)}
                onChange={(event) =>
                  togglePackage(option.id, event.target.checked)
                }
                type="checkbox"
              />
              <span>
                {option.name}
                {!option.active ? " (inactive)" : ""}
                <span className="ml-1 text-sm text-slate-500">
                  {option.baseAttractionCount} base
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-2">
          <p className="text-sm text-slate-600">
            {suggested === null
              ? "Select a package to see the attraction policy."
              : `Suggested ${suggested} · usual range ${
                  policy.minimum ?? 0
                }–${policy.maximum ?? 0}`}
          </p>
          <button
            className="button-secondary justify-self-start"
            disabled={suggested === null}
            onClick={() => {
              if (suggested === null) return;
              setPackageStatus("");
              setTotal(String(suggested));
            }}
            type="button"
          >
            Use suggested total
          </button>
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
          <label className="grid gap-1.5 font-medium">
            Out-of-range approval reason
            <textarea
              onChange={(event) => {
                setPackageStatus("");
                setApprovalReason(event.target.value);
              }}
              required={outOfRange}
              value={approvalReason}
            />
          </label>
        </div>
        {model.resourceOptions
          .filter(({ assignmentId }) => assignmentId)
          .map((resource) => {
            const assignmentId = resource.assignmentId!;
            const manual = manualAttributions.get(assignmentId);
            const displayedPackageIds =
              manual === null || manual === undefined
                ? model.packageOptions
                    .map(({ id }) => id)
                    .filter(
                      (id) =>
                        selectedPackages.has(id) &&
                        resource.packageTemplateIds.includes(id),
                    )
                : manual;
            const names = displayedPackageIds
              .map((id) =>
                model.packageOptions.find((option) => option.id === id)?.name
              )
              .filter((name): name is string => Boolean(name));
            return (
              <fieldset
                className="grid gap-2 rounded-lg border border-slate-200 p-3"
                key={assignmentId}
              >
                <legend className="px-1 font-semibold">{resource.name} attribution</legend>
                <p className="text-sm text-slate-600">
                  {manual === null || manual === undefined
                    ? `Inferred: ${names.join(", ") || "no packages"}`
                    : `Manual: ${names.join(", ") || "no packages"}`}
                </p>
                <label className="flex gap-2">
                  <input
                    checked={manual === null || manual === undefined}
                    name={`attribution-source-${assignmentId}`}
                    onChange={() => {
                      setPackageStatus("");
                      setManualAttributions((current) =>
                        new Map(current).set(assignmentId, null)
                      );
                    }}
                    type="radio"
                  />
                  Infer from resource tags
                </label>
                <label className="flex gap-2">
                  <input
                    checked={manual !== null && manual !== undefined}
                    name={`attribution-source-${assignmentId}`}
                    onChange={() => {
                      setPackageStatus("");
                      setManualAttributions((current) =>
                        new Map(current).set(
                          assignmentId,
                          model.packageOptions
                            .map(({ id }) => id)
                            .filter(
                              (id) =>
                                selectedPackages.has(id) &&
                                resource.packageTemplateIds.includes(id),
                          ),
                        )
                      );
                    }}
                    type="radio"
                  />
                  Choose packages manually
                </label>
                {manual !== null && manual !== undefined ? (
                  <div className="grid gap-1 pl-5">
                    {selectedPackageRecords.map((option) => (
                      <label className="flex gap-2" key={option.id}>
                        <input
                          checked={manual.includes(option.id)}
                          onChange={(event) => {
                            setPackageStatus("");
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

      <form
        className="grid content-start gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
        onSubmit={submitResources}
      >
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">
            Resource assignments
          </p>
          <h2 className="mt-1 text-xl font-bold">
            {model.assignedAttractionCount} assigned{" "}
            {model.assignedAttractionCount === 1 ? "attraction" : "attractions"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            A physical resource counts once, even when it belongs to several packages.
          </p>
        </div>
        {resourceError ? (
          <p ref={resourceErrorRef} role="alert" tabIndex={-1}>
            {resourceError}
          </p>
        ) : null}
        {resourceStatus ? (
          <p
            className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"
            role="status"
          >
            {resourceStatus}
          </p>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="font-semibold">Resources</legend>
          {model.resourceOptions.map((resource) => (
            <label className="flex items-start gap-2" key={resource.id}>
              <input
                checked={selectedResources.has(resource.id)}
                onChange={(event) => {
                  setResourceStatus("");
                  toggleSet(
                    setSelectedResources,
                    resource.id,
                    event.target.checked,
                  );
                }}
                type="checkbox"
              />
              <span className="grid">
                <span>
                {resource.name}
                {resource.status !== "available" ? ` (${resource.status})` : ""}
                {resource.countsAsAttraction ? (
                  <span className="ml-1 text-sm text-slate-500">Counts once</span>
                ) : null}
                </span>
                {!resource.assigned && selectedResources.has(resource.id) ? (
                  <span className="text-sm text-slate-500">
                    Inferred:{" "}
                    {resource.packageTemplateIds
                      .filter((id) => selectedPackages.has(id))
                      .map((id) =>
                        model.packageOptions.find((option) => option.id === id)?.name
                      )
                      .filter(Boolean)
                      .join(", ") || "no packages"}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
        <button className="button-primary justify-self-start" disabled={savingResources} type="submit">
          {savingResources ? "Saving…" : "Save resource assignments"}
        </button>
      </form>
    </div>
  );
}
