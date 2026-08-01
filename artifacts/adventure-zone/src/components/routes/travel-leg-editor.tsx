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

import { travelLegConfigurationSchema } from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

type TravelLegEditorResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── Sortable leg card ────────────────────────────────────────────────────────

function SortableLegCard({
  leg,
  onChangeName,
  onChangeColor,
  onDelete,
  deletingId,
  isOnlyLeg,
}: {
  leg: TravelLeg & { name: string; color: string };
  onChangeName: (id: string, value: string) => void;
  onChangeColor: (id: string, value: string) => void;
  onDelete?: (id: string) => void;
  deletingId: string | null;
  isOnlyLeg: boolean;
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

  return (
    <fieldset
      ref={setNodeRef}
      style={style}
      aria-label={`Travel leg ${leg.sortOrder}`}
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_8rem]"
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
      <label className="grid gap-1 text-sm font-semibold">
        <span className="sr-only">Travel leg {leg.sortOrder} name</span>
        Name
        <input
          aria-label={`Travel leg ${leg.sortOrder} name`}
          onChange={(event) => onChangeName(leg.id, event.currentTarget.value)}
          type="text"
          value={leg.name}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        <span className="sr-only">Travel leg {leg.sortOrder} color</span>
        Color
        <input
          aria-label={`Travel leg ${leg.sortOrder} color`}
          className="h-11 w-full"
          onChange={(event) => onChangeColor(leg.id, event.currentTarget.value)}
          type="color"
          value={leg.color}
        />
      </label>
    </fieldset>
  );
}

// ─── Editor ───────────────────────────────────────────────────────────────────

export function TravelLegEditor({
  legs,
  onSubmit,
  onAdd,
  onDelete,
}: {
  legs: TravelLeg[];
  onSubmit: (
    input: { legs: TravelLeg[] },
  ) => Promise<TravelLegEditorResult> | TravelLegEditorResult;
  onAdd?: () => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [values, setValues] = useState(() => legs.map((leg) => ({ ...leg })));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  function changeLeg(id: string, field: "name" | "color", value: string) {
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
      setValues(parsed.data.legs);
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

  return (
    <form
      className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-xl font-bold">Configure travel legs</h2>
        <p className="mt-1 text-sm text-slate-600">
          Rename, recolor, or drag to reorder operational legs. You can have
          between 1 and 9 legs.
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
                onChangeName={(id, value) => changeLeg(id, "name", value)}
                onChangeColor={(id, value) => changeLeg(id, "color", value)}
                onDelete={onDelete ? handleDelete : undefined}
                deletingId={deletingId}
                isOnlyLeg={values.length <= 1}
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
            disabled={isAdding || values.length >= 9}
            onClick={handleAdd}
            title={values.length >= 9 ? "Maximum of 9 legs reached" : undefined}
            type="button"
          >
            {isAdding ? "Adding…" : "Add leg"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
