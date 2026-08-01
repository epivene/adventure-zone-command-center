"use client";

import { useState, type FormEvent } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import {
  travelLegConfigurationSchema,
  type TravelLegConfiguration,
} from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

type TravelLegEditorResult =
  | { ok: true }
  | { ok: false; error: string };

export type LegResourceSummary = {
  legId: string;
  id: string;
  code: string;
  name: string;
  category: string;
};

type LegFormValues = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  archived: boolean;
  baseAddress: string;
  defaultVehicleName: string;
  defaultMpg: string;
};

function toFormValues(leg: TravelLeg): LegFormValues {
  return {
    id: leg.id,
    name: leg.name,
    color: leg.color,
    sortOrder: leg.sortOrder,
    archived: Boolean(leg.archivedAt),
    baseAddress: leg.baseAddress ?? "",
    defaultVehicleName: leg.defaultVehicleName ?? "",
    defaultMpg: leg.defaultMpg === null ? "" : String(leg.defaultMpg),
  };
}

type EditableField =
  | "name"
  | "color"
  | "baseAddress"
  | "defaultVehicleName"
  | "defaultMpg";

// ─── Sortable leg card ────────────────────────────────────────────────────────

function SortableLegCard({
  leg,
  resources,
  onChangeField,
  onDelete,
  onArchive,
  onRestore,
  deletingId,
  archivingId,
  isOnlyLeg,
  isLastActiveLeg,
}: {
  leg: LegFormValues;
  resources: LegResourceSummary[];
  onChangeField: (id: string, field: EditableField, value: string) => void;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  deletingId: string | null;
  archivingId: string | null;
  isOnlyLeg: boolean;
  isLastActiveLeg: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: leg.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const isArchiveBusy = archivingId === leg.id;

  return (
    <fieldset
      ref={setNodeRef}
      style={style}
      aria-label={`Travel leg ${leg.sortOrder}`}
      className={`grid gap-3 rounded-lg border p-3 ${
        leg.archived
          ? "border-slate-200 bg-slate-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <legend className="flex items-center gap-1 px-1 text-sm font-bold">
        {/* Drag handle */}
        <button
          type="button"
          aria-label={`Drag to reorder leg ${leg.sortOrder}`}
          className="cursor-grab touch-none rounded p-0.5 text-slate-400 hover:text-slate-600 active:cursor-grabbing disabled:cursor-default"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        Leg {leg.sortOrder}
        {leg.archived ? (
          <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
            Archived
          </span>
        ) : null}
        {leg.archived
          ? onRestore && (
              <button
                aria-label={`Restore leg ${leg.sortOrder}`}
                className="ml-1 rounded px-1.5 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                disabled={isArchiveBusy}
                onClick={() => onRestore(leg.id)}
                type="button"
              >
                {isArchiveBusy ? "Restoring…" : "Restore"}
              </button>
            )
          : onArchive && (
              <button
                aria-label={`Archive leg ${leg.sortOrder}`}
                className="ml-1 rounded px-1.5 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                disabled={isArchiveBusy || isLastActiveLeg}
                onClick={() => onArchive(leg.id)}
                title={
                  isLastActiveLeg
                    ? "At least one active leg is required"
                    : undefined
                }
                type="button"
              >
                {isArchiveBusy ? "Archiving…" : "Archive"}
              </button>
            )}
        {onDelete ? (
          <button
            aria-label={`Delete leg ${leg.sortOrder}`}
            className="ml-1 rounded px-1.5 py-0.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
            disabled={deletingId === leg.id || isOnlyLeg}
            onClick={() => onDelete(leg.id)}
            type="button"
          >
            {deletingId === leg.id ? "Deleting…" : "Delete"}
          </button>
        ) : null}
      </legend>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <label className="grid gap-1 text-sm font-semibold">
          Name
          <input
            aria-label={`Travel leg ${leg.sortOrder} name`}
            onChange={(event) =>
              onChangeField(leg.id, "name", event.currentTarget.value)
            }
            type="text"
            value={leg.name}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Color
          <input
            aria-label={`Travel leg ${leg.sortOrder} color`}
            className="h-11 w-full"
            onChange={(event) =>
              onChangeField(leg.id, "color", event.currentTarget.value)
            }
            type="color"
            value={leg.color}
          />
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        Base address
        <input
          aria-label={`Travel leg ${leg.sortOrder} base address`}
          onChange={(event) =>
            onChangeField(leg.id, "baseAddress", event.currentTarget.value)
          }
          placeholder="Where this leg is based"
          type="text"
          value={leg.baseAddress}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <label className="grid gap-1 text-sm font-semibold">
          Default vehicle
          <input
            aria-label={`Travel leg ${leg.sortOrder} default vehicle`}
            onChange={(event) =>
              onChangeField(
                leg.id,
                "defaultVehicleName",
                event.currentTarget.value,
              )
            }
            placeholder="e.g. Box truck 1"
            type="text"
            value={leg.defaultVehicleName}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Default MPG
          <input
            aria-label={`Travel leg ${leg.sortOrder} default MPG`}
            inputMode="decimal"
            min="0"
            onChange={(event) =>
              onChangeField(leg.id, "defaultMpg", event.currentTarget.value)
            }
            step="0.1"
            type="number"
            value={leg.defaultMpg}
          />
        </label>
      </div>
      {resources.length > 0 ? (
        <div className="rounded-md border border-slate-100 bg-slate-50 p-2">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Assigned resources
          </p>
          <ul className="mt-1 grid gap-0.5 text-sm text-slate-700">
            {resources.map((resource) => (
              <li key={resource.id}>
                <span className="font-semibold">{resource.name}</span>{" "}
                <span className="text-slate-500">
                  ({resource.code} · {resource.category})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </fieldset>
  );
}

// ─── Editor ───────────────────────────────────────────────────────────────────

export function TravelLegEditor({
  legs,
  legResources = [],
  onSubmit,
  onAdd,
  onDelete,
  onArchive,
  onRestore,
}: {
  legs: TravelLeg[];
  legResources?: LegResourceSummary[];
  onSubmit: (
    input: TravelLegConfiguration,
  ) => Promise<TravelLegEditorResult> | TravelLegEditorResult;
  onAdd?: () => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onArchive?: (id: string) => Promise<void>;
  onRestore?: (id: string) => Promise<void>;
}) {
  // Only active legs are editable/reorderable; archived legs render read-only.
  const [values, setValues] = useState<LegFormValues[]>(() =>
    legs
      .filter((leg) => !leg.archivedAt)
      .map(toFormValues)
      .map((leg, i) => ({ ...leg, sortOrder: i + 1 })),
  );
  const archivedLegs = legs.filter((leg) => leg.archivedAt);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const totalLegs = values.length + archivedLegs.length;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setValues((current) => {
      const oldIndex = current.findIndex((v) => v.id === active.id);
      const newIndex = current.findIndex((v) => v.id === over.id);
      const reordered = arrayMove(current, oldIndex, newIndex);
      // Reassign sort orders (1-N) to match the new visual sequence
      return reordered.map((leg, i) => ({ ...leg, sortOrder: i + 1 }));
    });
    setSaved(false);
  }

  function changeLeg(id: string, field: EditableField, value: string) {
    setValues((current) =>
      current.map((leg) => (leg.id === id ? { ...leg, [field]: value } : leg)),
    );
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = travelLegConfigurationSchema.safeParse({ legs: values });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review the travel legs.");
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
      setValues((current) =>
        current.map((leg) => {
          const next = parsed.data.legs.find((l) => l.id === leg.id);
          if (!next) return leg;
          return {
            ...leg,
            name: next.name,
            color: next.color,
            sortOrder: next.sortOrder,
            baseAddress: next.baseAddress ?? "",
            defaultVehicleName: next.defaultVehicleName ?? "",
            defaultMpg:
              next.defaultMpg === null ? "" : String(next.defaultMpg),
          };
        }),
      );
      setSaved(true);
    } catch {
      setError("Travel legs could not be saved. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAdd() {
    if (!onAdd) return;
    setError("");
    setSaved(false);
    setIsAdding(true);
    try {
      await onAdd();
    } catch (e: any) {
      setError(e.message ?? "Could not add travel leg.");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!onDelete) return;
    setError("");
    setSaved(false);
    setDeletingId(id);
    try {
      await onDelete(id);
    } catch (e: any) {
      setError(e.message ?? "Could not delete travel leg.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleArchive(id: string) {
    if (!onArchive) return;
    setError("");
    setSaved(false);
    setArchivingId(id);
    try {
      await onArchive(id);
    } catch (e: any) {
      setError(e.message ?? "Could not archive travel leg.");
    } finally {
      setArchivingId(null);
    }
  }

  async function handleRestore(id: string) {
    if (!onRestore) return;
    setError("");
    setSaved(false);
    setArchivingId(id);
    try {
      await onRestore(id);
    } catch (e: any) {
      setError(e.message ?? "Could not restore travel leg.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <form
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-xl font-bold">Configure travel legs</h2>
        <p className="mt-1 text-sm text-slate-600">
          Rename, recolor, or drag to reorder operational legs. Set each
          leg&apos;s base address, default vehicle, and default MPG for trip
          planning. Archived legs stay on old bookings but are hidden from new
          ones. You can have between 1 and 9 legs.
        </p>
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
          Travel legs saved.
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={values.map((v) => v.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {values.map((leg) => (
              <SortableLegCard
                key={leg.id}
                leg={leg}
                resources={legResources.filter((r) => r.legId === leg.id)}
                onChangeField={changeLeg}
                onDelete={onDelete ? handleDelete : undefined}
                onArchive={onArchive ? handleArchive : undefined}
                onRestore={onRestore ? handleRestore : undefined}
                deletingId={deletingId}
                archivingId={archivingId}
                isOnlyLeg={totalLegs <= 1}
                isLastActiveLeg={values.length <= 1}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex flex-wrap gap-3">
        <button className="button-primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving…" : "Save travel legs"}
        </button>
        {onAdd ? (
          <button
            className="button-secondary"
            disabled={isAdding || totalLegs >= 9}
            onClick={handleAdd}
            title={totalLegs >= 9 ? "Maximum of 9 legs reached" : undefined}
            type="button"
          >
            {isAdding ? "Adding…" : "Add leg"}
          </button>
        ) : null}
      </div>

      {archivedLegs.length > 0 ? (
        <section aria-label="Archived travel legs" className="grid gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Archived legs
          </h3>
          <div className="grid gap-2 lg:grid-cols-2">
            {archivedLegs.map((leg) => (
              <div
                key={leg.id}
                className="grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: leg.color }}
                  />
                  <span className="font-bold">{leg.name}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Archived
                  </span>
                  {onRestore ? (
                    <button
                      aria-label={`Restore leg ${leg.name}`}
                      className="ml-auto rounded px-1.5 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                      disabled={archivingId === leg.id}
                      onClick={() => handleRestore(leg.id)}
                      type="button"
                    >
                      {archivingId === leg.id ? "Restoring…" : "Restore"}
                    </button>
                  ) : null}
                </div>
                <p className="text-slate-600">
                  {[
                    leg.baseAddress,
                    leg.defaultVehicleName,
                    leg.defaultMpg !== null && leg.defaultMpg !== undefined
                      ? `${leg.defaultMpg} MPG`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No trip defaults set"}
                </p>
                <p className="text-xs text-slate-500">
                  Restore this leg to edit it. It stays on old bookings but is
                  hidden from new ones.
                </p>
                {legResources.filter((r) => r.legId === leg.id).length > 0 ? (
                  <p className="text-xs text-slate-500">
                    Assigned resources:{" "}
                    {legResources
                      .filter((r) => r.legId === leg.id)
                      .map((r) => r.name)
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </form>
  );
}
