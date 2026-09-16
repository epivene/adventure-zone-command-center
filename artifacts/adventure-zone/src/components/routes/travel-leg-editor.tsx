"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import {
  travelLegDetailsSchema,
  travelLegOrderSchema,
  type TravelLegDetails,
  type TravelLegOrder,
} from "@/features/routes/travel-leg-input";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

type SaveLegResult =
  | { ok: true; leg: TravelLeg }
  | { ok: false; error: string };

type SaveOrderResult =
  | { ok: true; legs: TravelLeg[] }
  | { ok: false; error: string };

export type LegResourceSummary = {
  legId: string;
  id: string;
  code: string;
  name: string;
  category: string;
  yearEndInspectionSummary?: {
    status: "draft" | "in_progress" | "completed";
    inspected: number;
    total: number;
    needsAttention: number;
  };
};

export type LegManagerAccessStatus = {
  legId: string;
  legName: string;
  archivedAt: string | Date | null;
  enabled: boolean;
  sessionVersion: number | null;
};

type LegFormValues = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  baseAddress: string;
  defaultVehicleName: string;
  defaultMpg: string;
};

type EditableField = "name" | "color" | "baseAddress" | "defaultVehicleName" | "defaultMpg";

function toFormValues(leg: TravelLeg): LegFormValues {
  return {
    id: leg.id,
    name: leg.name,
    color: leg.color,
    sortOrder: leg.sortOrder,
    baseAddress: leg.baseAddress ?? "",
    defaultVehicleName: leg.defaultVehicleName ?? "",
    defaultMpg: leg.defaultMpg == null ? "" : String(leg.defaultMpg),
  };
}

function details(leg: LegFormValues) {
  return {
    name: leg.name,
    color: leg.color,
    baseAddress: leg.baseAddress,
    defaultVehicleName: leg.defaultVehicleName,
    defaultMpg: leg.defaultMpg,
  };
}

function sameDetails(left: ReturnType<typeof details>, right: ReturnType<typeof details>) {
  return Object.keys(left).every(
    (key) => left[key as keyof typeof left] === right[key as keyof typeof right],
  );
}

export function TravelLegEditor({
  legs,
  legResources = [],
  managerAccess = [],
  onSaveLeg,
  onSaveOrder,
  onAdd,
  onArchive,
  onRestore,
  onSetManagerPassword,
  onSignOutManagerDevices,
}: {
  legs: TravelLeg[];
  legResources?: LegResourceSummary[];
  managerAccess?: LegManagerAccessStatus[];
  onSaveLeg: (
    id: string,
    input: TravelLegDetails,
  ) => Promise<SaveLegResult> | SaveLegResult;
  onSaveOrder: (
    input: TravelLegOrder,
  ) => Promise<SaveOrderResult> | SaveOrderResult;
  onAdd?: () => Promise<void>;
  /** Deprecated compatibility prop. Permanent delete is intentionally not rendered. */
  onDelete?: (id: string) => Promise<void>;
  onArchive?: (id: string) => Promise<void>;
  onRestore?: (id: string) => Promise<void>;
  onSetManagerPassword?: (legId: string, password: string) => Promise<void>;
  onSignOutManagerDevices?: (legId: string) => Promise<void>;
}) {
  const activeLegs = legs.filter((leg) => !leg.archivedAt);
  const archivedLegs = legs.filter((leg) => leg.archivedAt);
  const [values, setValues] = useState<LegFormValues[]>(() =>
    activeLegs.map(toFormValues).map((leg, index) => ({ ...leg, sortOrder: index + 1 })),
  );
  const [savedDetails, setSavedDetails] = useState<Record<string, ReturnType<typeof details>>>(() =>
    Object.fromEntries(activeLegs.map((leg) => {
      const form = toFormValues(leg);
      return [leg.id, details(form)];
    })),
  );
  const [savedOrder, setSavedOrder] = useState(() => activeLegs.map((leg) => leg.id));
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [savingLegId, setSavingLegId] = useState<string | null>(null);
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null);
  const [savedLegIds, setSavedLegIds] = useState<Set<string>>(() => new Set());
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [orderSaved, setOrderSaved] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const currentOrder = values.map((leg) => leg.id);
  const orderDirty =
    currentOrder.length !== savedOrder.length ||
    currentOrder.some((id, index) => savedOrder[index] !== id);

  function isLegDirty(leg: LegFormValues) {
    const baseline = savedDetails[leg.id];
    return !baseline || !sameDetails(details(leg), baseline);
  }

  function changeLeg(id: string, field: EditableField, value: string) {
    setValues((current) =>
      current.map((leg) => (leg.id === id ? { ...leg, [field]: value } : leg)),
    );
    setSavedLegIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function moveLeg(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= values.length) return;
    setValues((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((leg, position) => ({ ...leg, sortOrder: position + 1 }));
    });
    setOrderSaved(false);
  }

  async function handleSaveLeg(id: string) {
    const leg = values.find((value) => value.id === id);
    if (!leg) return;
    const parsed = travelLegDetailsSchema.safeParse(details(leg));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review this travel leg.");
      return;
    }
    setError("");
    setMessage("");
    setSavingLegId(id);
    try {
      const result = await onSaveLeg(id, parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const saved = toFormValues(result.leg);
      setSavedDetails((current) => ({ ...current, [id]: details(saved) }));
      setValues((current) =>
        current.map((value) =>
          value.id === id ? { ...value, ...details(saved) } : value,
        ),
      );
      setSavedLegIds((current) => new Set(current).add(id));
      setMessage(`${saved.name} saved.`);
    } catch {
      setError("Travel leg could not be saved. Try again.");
    } finally {
      setSavingLegId(null);
    }
  }

  async function handleSavePassword(legId: string, enabled: boolean) {
    if (!onSetManagerPassword) return;
    const password = passwords[legId] ?? "";
    if (!password) return;
    setError("");
    setMessage("");
    setSavingAccessId(legId);
    try {
      await onSetManagerPassword(legId, password);
      setPasswords((current) => ({ ...current, [legId]: "" }));
      setMessage(enabled ? "Manager portal password changed." : "Manager portal enabled.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update manager portal access.");
    } finally {
      setSavingAccessId(null);
    }
  }

  async function handleSignOutDevices(legId: string, legName: string) {
    if (!onSignOutManagerDevices) return;
    if (!window.confirm(`Sign out all manager devices for ${legName}?`)) return;
    setError("");
    setMessage("");
    setSavingAccessId(legId);
    try {
      await onSignOutManagerDevices(legId);
      setMessage(`${legName} manager devices signed out.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign out manager devices.");
    } finally {
      setSavingAccessId(null);
    }
  }

  async function handleSaveOrder() {
    const parsed = travelLegOrderSchema.safeParse({
      legs: values.map(({ id, sortOrder }) => ({ id, sortOrder })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review the travel-leg order.");
      return;
    }
    setError("");
    setIsSavingOrder(true);
    try {
      const result = await onSaveOrder(parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedOrder(values.map((leg) => leg.id));
      setOrderSaved(true);
    } catch {
      setError("Travel-leg order could not be saved. Try again.");
    } finally {
      setIsSavingOrder(false);
    }
  }

  async function handleAdd() {
    if (!onAdd) return;
    setError("");
    setIsAdding(true);
    try {
      await onAdd();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not add travel leg.");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleArchive(id: string) {
    if (!onArchive) return;
    setError("");
    setArchivingId(id);
    try {
      await onArchive(id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not archive travel leg.");
    } finally {
      setArchivingId(null);
    }
  }

  async function handleRestore(id: string) {
    if (!onRestore) return;
    setError("");
    setArchivingId(id);
    try {
      await onRestore(id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not restore travel leg.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="text-xl font-bold">Managers & travel legs</h2>
        <p className="mt-1 text-sm text-slate-600">
          Each manager and travel leg share one name. Configure route defaults, assigned equipment, and manager portal access together.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {values.map((leg, index) => {
          const dirty = isLegDirty(leg);
          const resources = legResources.filter((resource) => resource.legId === leg.id);
          const access = managerAccess.find((row) => row.legId === leg.id);
          const accessEnabled = Boolean(access?.enabled);
          const password = passwords[leg.id] ?? "";
          const accessBusy = savingAccessId === leg.id;

          return (
            <fieldset key={leg.id} aria-label={`Travel leg ${leg.sortOrder}`} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <legend className="flex items-center gap-2 px-1 text-sm font-bold">
                Leg {leg.sortOrder}
                <button type="button" aria-label={`Move leg ${leg.sortOrder} up`} disabled={index === 0} onClick={() => moveLeg(index, -1)} className="rounded p-1 text-slate-500 disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" aria-label={`Move leg ${leg.sortOrder} down`} disabled={index === values.length - 1} onClick={() => moveLeg(index, 1)} className="rounded p-1 text-slate-500 disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" />
                </button>
                {onArchive ? (
                  <button type="button" aria-label={`Archive leg ${leg.sortOrder}`} disabled={values.length <= 1 || archivingId === leg.id} onClick={() => handleArchive(leg.id)} className="ml-auto rounded px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40">
                    {archivingId === leg.id ? "Archiving…" : "Archive"}
                  </button>
                ) : null}
              </legend>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <label className="grid gap-1 text-sm font-semibold">Manager / Leg name
                  <input aria-label="Manager / Leg name" type="text" value={leg.name} onChange={(event) => changeLeg(leg.id, "name", event.currentTarget.value)} />
                </label>
                <label className="grid gap-1 text-sm font-semibold">Color
                  <input aria-label={`Travel leg ${leg.sortOrder} color`} className="h-11 w-full" type="color" value={leg.color} onChange={(event) => changeLeg(leg.id, "color", event.currentTarget.value)} />
                </label>
              </div>

              <label className="grid gap-1 text-sm font-semibold">Base address
                <input aria-label={`Travel leg ${leg.sortOrder} base address`} type="text" value={leg.baseAddress} onChange={(event) => changeLeg(leg.id, "baseAddress", event.currentTarget.value)} placeholder="Where this manager/leg is based" />
              </label>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <label className="grid gap-1 text-sm font-semibold">Default vehicle
                  <input aria-label={`Travel leg ${leg.sortOrder} default vehicle`} type="text" value={leg.defaultVehicleName} onChange={(event) => changeLeg(leg.id, "defaultVehicleName", event.currentTarget.value)} placeholder="e.g. Box truck 1" />
                </label>
                <label className="grid gap-1 text-sm font-semibold">Default MPG
                  <input aria-label={`Travel leg ${leg.sortOrder} default MPG`} type="number" inputMode="decimal" min="0" step="0.1" value={leg.defaultMpg} onChange={(event) => changeLeg(leg.id, "defaultMpg", event.currentTarget.value)} />
                </label>
              </div>

              {resources.length > 0 ? (
                <div className="rounded-md border border-slate-100 bg-slate-50 p-2 text-sm">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Assigned resources</p>
                  <p className="mt-1 text-slate-700">{resources.map((resource) => resource.name).join(", ")}</p>
                </div>
              ) : null}

              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">Manager portal</p>
                    <p className="text-xs text-slate-500">{accessEnabled ? "Portal enabled" : "Portal not configured"}</p>
                  </div>
                  {accessEnabled && onSignOutManagerDevices ? (
                    <button type="button" className="button-secondary" disabled={accessBusy} onClick={() => handleSignOutDevices(leg.id, leg.name)}>
                      Sign Out All Devices
                    </button>
                  ) : null}
                </div>
                {onSetManagerPassword ? (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label className="grid gap-1 text-sm font-semibold">{accessEnabled ? "New password" : "Password"}
                      <input
                        aria-label={accessEnabled ? "New password" : "Password"}
                        autoComplete="new-password"
                        type="password"
                        value={password}
                        placeholder={accessEnabled ? "Leave blank to keep current" : "Set password"}
                        onChange={(event) => { const value = event.currentTarget.value; setPasswords((current) => ({ ...current, [leg.id]: value })); }}
                      />
                    </label>
                    <button type="button" className="button-primary" disabled={!password || accessBusy} onClick={() => handleSavePassword(leg.id, accessEnabled)}>
                      {accessBusy ? "Saving…" : accessEnabled ? "Change password" : "Enable portal"}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-3">
                {savedLegIds.has(leg.id) && !dirty ? <span role="status" className="text-sm font-semibold text-emerald-700">Saved</span> : null}
                <button type="button" className="button-primary" disabled={!dirty || savingLegId === leg.id} onClick={() => handleSaveLeg(leg.id)}>
                  {savingLegId === leg.id ? "Saving…" : "Save leg"}
                </button>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="button-primary" disabled={!orderDirty || isSavingOrder} onClick={handleSaveOrder}>
          {isSavingOrder ? "Saving order…" : "Save order"}
        </button>
        {orderSaved && !orderDirty ? <span role="status" className="text-sm font-semibold text-emerald-700">Order saved</span> : null}
        {onAdd ? (
          <button type="button" className="button-secondary" disabled={isAdding} onClick={handleAdd}>
            {isAdding ? "Adding…" : "Add leg"}
          </button>
        ) : null}
        {archivedLegs.length > 0 ? (
          <button type="button" className="button-secondary" onClick={() => setShowArchived((current) => !current)}>
            {showArchived ? "Hide Archived" : `View Archived (${archivedLegs.length})`}
          </button>
        ) : null}
      </div>

      {showArchived && archivedLegs.length > 0 ? (
        <section aria-label="Archived travel legs" className="grid gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Archived managers / legs</h3>
          <div className="grid gap-2 lg:grid-cols-2">
            {archivedLegs.map((leg) => (
              <div key={leg.id} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="inline-block size-3 rounded-full" style={{ backgroundColor: leg.color }} />
                  <span className="font-bold">{leg.name}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">Archived</span>
                  {onRestore ? (
                    <button type="button" aria-label={`Restore leg ${leg.name}`} disabled={archivingId === leg.id} onClick={() => handleRestore(leg.id)} className="ml-auto rounded px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
                      {archivingId === leg.id ? "Restoring…" : "Restore"}
                    </button>
                  ) : null}
                </div>
                <p className="text-slate-600">
                  {[leg.baseAddress, leg.defaultVehicleName, leg.defaultMpg != null ? `${leg.defaultMpg} MPG` : null].filter(Boolean).join(" · ") || "No trip defaults set"}
                </p>
                <p className="text-xs text-slate-500">Restore this manager/leg to edit it or use manager portal access. Historical bookings stay attached while archived.</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

