"use client";

import { useState, type FormEvent } from "react";

import type { PackageTemplateSettingsRecord } from "@/features/packages/package-repository";
import {
  resourceChecklistTagValues,
  resourceInputSchema,
  type PackageCountCategory,
  type ResourceChecklistTag,
  type ResourceInput,
} from "@/features/resources/resource-input";
import type { ResourceInventoryRecord } from "@/features/resources/resource-repository";

type EditorResult = { ok: true } | { ok: false; error: string };

export type ResourceTravelLegOption = {
  id: string;
  name: string;
  archivedAt: Date | null;
};

const checklistTagLabels: Record<ResourceChecklistTag, string> = {
  inflatable: "Inflatable",
  blower_powered: "Blower powered",
  wet_attraction: "Wet attraction",
  multi_section: "Multi-section",
  action_pursuit: "Action pursuit",
  carnival_game: "Carnival game",
  trailer_shared: "Shared trailer",
};

const emptyResource: ResourceInput = {
  id: null,
  code: "",
  name: "",
  category: "",
  countsAsAttraction: false,
  packageCountCategory: "main_attraction",
  packageTemplateIds: [],
  checklistTags: [],
  normalTravelLegId: null,
  movable: false,
  setupMinutes: 0,
  teardownMinutes: 0,
  minimumTransferMinutes: 0,
  status: "available",
};

function ResourceForm({
  initialValue,
  packageTemplates,
  travelLegs,
  onSubmit,
}: {
  initialValue: ResourceInput;
  packageTemplates: PackageTemplateSettingsRecord[];
  travelLegs: ResourceTravelLegOption[];
  onSubmit: (input: ResourceInput) => Promise<EditorResult> | EditorResult;
}) {
  const existing = initialValue.id !== null;
  const initialName = initialValue.name;
  const [value, setValue] = useState<ResourceInput>({
    ...initialValue,
    packageCountCategory: initialValue.packageCountCategory ?? "main_attraction",
    checklistTags: initialValue.checklistTags ?? [],
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const visibleTemplates = packageTemplates.filter(
    (template) =>
      template.active || initialValue.packageTemplateIds.includes(template.id),
  );
  const visibleTravelLegs = travelLegs.filter(
    (leg) =>
      leg.archivedAt === null || initialValue.normalTravelLegId === leg.id,
  );

  function update<K extends keyof ResourceInput>(
    key: K,
    next: ResourceInput[K],
  ) {
    setValue((current) => ({ ...current, [key]: next }));
    setSaved(false);
  }

  function togglePackage(packageTemplateId: string, checked: boolean) {
    update(
      "packageTemplateIds",
      checked
        ? [...value.packageTemplateIds, packageTemplateId]
        : value.packageTemplateIds.filter((id) => id !== packageTemplateId),
    );
  }

  function toggleChecklistTag(tag: ResourceChecklistTag, checked: boolean) {
    const current = value.checklistTags ?? [];
    update(
      "checklistTags",
      checked ? [...current, tag] : current.filter((item) => item !== tag),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = resourceInputSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review this resource.");
      setSaved(false);
      return;
    }

    setError("");
    setSaved(false);
    setIsSubmitting(true);
    try {
      const result = await onSubmit(parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setValue(existing ? parsed.data : emptyResource);
      setSaved(true);
    } catch {
      setError("The resource could not be saved. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const formName = existing
    ? `Edit ${initialName} resource`
    : "Create resource";

  return (
    <form
      aria-label={formName}
      className="grid gap-4 rounded-xl border border-slate-200 p-4"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">
          Stable code
          <input
            aria-label="Stable code"
            onChange={(event) => update("code", event.currentTarget.value)}
            readOnly={existing}
            type="text"
            value={value.code}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Resource name
          <input
            aria-label="Resource name"
            onChange={(event) => update("name", event.currentTarget.value)}
            type="text"
            value={value.name}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Category
          <input
            aria-label="Category"
            onChange={(event) => update("category", event.currentTarget.value)}
            type="text"
            value={value.category}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">
          Package counting
          <select
            aria-label="Package counting"
            onChange={(event) =>
              update(
                "packageCountCategory",
                event.currentTarget.value as PackageCountCategory,
              )
            }
            value={value.packageCountCategory ?? "main_attraction"}
          >
            <option value="main_attraction">Main attraction</option>
            <option value="game_extra">Carnival game / extra</option>
            <option value="special_shared">Special / shared equipment</option>
          </select>
          <span className="text-xs font-normal text-slate-500">
            Only main attractions count toward a package&apos;s normal attraction range.
          </span>
        </label>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-bold">Package tags</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTemplates.map((template) => {
            const retainedInactive =
              !template.active &&
              initialValue.packageTemplateIds.includes(template.id);
            const label = retainedInactive
              ? `${template.name} (Inactive — retained for history)`
              : template.name;
            return (
              <label
                className="flex min-h-11 items-center gap-2 text-sm font-semibold"
                key={template.id}
              >
                <input
                  aria-label={label}
                  checked={value.packageTemplateIds.includes(template.id)}
                  onChange={(event) =>
                    togglePackage(template.id, event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                {label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <legend className="px-1 text-sm font-bold">Inspection tags</legend>
        <p className="text-xs text-slate-600">
          These tags control which safety checklist items appear for this resource. Choose only what actually applies to the equipment.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {resourceChecklistTagValues.map((tag) => (
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold" key={tag}>
              <input
                aria-label={checklistTagLabels[tag]}
                checked={(value.checklistTags ?? []).includes(tag)}
                onChange={(event) => toggleChecklistTag(tag, event.currentTarget.checked)}
                type="checkbox"
              />
              {checklistTagLabels[tag]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">
          Normal travel leg
          <select
            aria-label="Normal travel leg"
            onChange={(event) =>
              update("normalTravelLegId", event.currentTarget.value || null)
            }
            value={value.normalTravelLegId ?? ""}
          >
            <option value="">No normal leg</option>
            {visibleTravelLegs.map((leg) => (
              <option key={leg.id} value={leg.id}>
                {leg.name}
                {leg.archivedAt
                  ? " (Archived — retained for history)"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Availability status
          <select
            aria-label="Availability status"
            onChange={(event) =>
              update(
                "status",
                event.currentTarget.value as ResourceInput["status"],
              )
            }
            value={value.status}
          >
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
            <option value="maintenance">Maintenance</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input
            aria-label="Counts as an attraction"
            checked={value.countsAsAttraction}
            onChange={(event) =>
              update("countsAsAttraction", event.currentTarget.checked)
            }
            type="checkbox"
          />
          Counts as a physical attraction/resource
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input
            aria-label="Movable between events"
            checked={value.movable}
            onChange={(event) => update("movable", event.currentTarget.checked)}
            type="checkbox"
          />
          Movable between events
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ["setupMinutes", "Setup minutes"],
          ["teardownMinutes", "Teardown minutes"],
          ["minimumTransferMinutes", "Minimum transfer minutes"],
        ] as const).map(([key, label]) => (
          <label className="grid gap-1 text-sm font-semibold" key={key}>
            {label}
            <input
              aria-label={label}
              min={0}
              onChange={(event) =>
                update(key, Number(event.currentTarget.value))
              }
              step={1}
              type="number"
              value={value[key]}
            />
          </label>
        ))}
      </div>

      {error ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {saved ? (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"
          role="status"
        >
          Resource saved.
        </p>
      ) : null}

      <div>
        <button className="button-primary" disabled={isSubmitting} type="submit">
          {isSubmitting
            ? "Saving…"
            : existing
              ? "Save resource"
              : "Create resource"}
        </button>
      </div>
    </form>
  );
}

export function ResourceInventoryEditor({
  resources,
  packageTemplates,
  travelLegs,
  onSubmit,
}: {
  resources: ResourceInventoryRecord[];
  packageTemplates: PackageTemplateSettingsRecord[];
  travelLegs: ResourceTravelLegOption[];
  onSubmit: (input: ResourceInput) => Promise<EditorResult> | EditorResult;
}) {
  return (
    <section
      aria-labelledby="resource-inventory-editor-title"
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div>
        <h2 className="text-xl font-bold" id="resource-inventory-editor-title">
          Resource inventory
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Add operational equipment or update its package tags, inspection tags, package-count meaning, travel needs, timing, and availability. Archive retired resources to preserve booking history.
        </p>
      </div>

      <ResourceForm
        initialValue={emptyResource}
        onSubmit={onSubmit}
        packageTemplates={packageTemplates}
        travelLegs={travelLegs}
      />
      <div className="grid gap-4">
        {resources.map((resource) => (
          <ResourceForm
            initialValue={resource}
            key={resource.id}
            onSubmit={onSubmit}
            packageTemplates={packageTemplates}
            travelLegs={travelLegs}
          />
        ))}
      </div>
    </section>
  );
}
