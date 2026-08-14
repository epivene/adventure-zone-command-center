/**
 * Add / Edit form for an organization_locations record.
 * Renders as a modal overlay.
 *
 * Website values are stored as-entered; the server normalizes them to an
 * https:// URL on save. The edit form shows what is currently stored so the
 * user can review and correct the value.
 */
import { useState } from "react";

import { apiFetch } from "@/lib/auth-token";

export type LocationFormFields = {
  label: string;
  venueName: string;
  address1: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
  website: string;
  phone: string;
  email: string;
  localStatus: string;
  travelLegId: string;
  /** Decimal latitude string; empty string means "not set". */
  lat: string;
  /** Decimal longitude string; empty string means "not set". */
  lng: string;
};

export type LocationFormInitial = Partial<LocationFormFields> & { id: string };

const EMPTY: LocationFormFields = {
  label: "",
  venueName: "",
  address1: "",
  address2: "",
  city: "",
  region: "",
  postalCode: "",
  website: "",
  phone: "",
  email: "",
  localStatus: "",
  travelLegId: "",
  lat: "",
  lng: "",
};

function parseCoord(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return isFinite(n) ? n : null;
}

function toBody(fields: LocationFormFields): Record<string, string | number | null> {
  const lat = parseCoord(fields.lat);
  const lng = parseCoord(fields.lng);
  return {
    label: fields.label.trim(),
    venueName: fields.venueName.trim() || null,
    address1: fields.address1.trim() || null,
    address2: fields.address2.trim() || null,
    city: fields.city.trim() || null,
    region: fields.region.trim() || null,
    postalCode: fields.postalCode.trim() || null,
    // Sent as-is; server normalizes to https:// on save.
    website: fields.website.trim() || null,
    phone: fields.phone.trim() || null,
    email: fields.email.trim() || null,
    localStatus: fields.localStatus.trim() || null,
    travelLegId: fields.travelLegId || null,
    lat,
    lng,
  };
}

function coordError(lat: string, lng: string): string | null {
  const latFilled = lat.trim() !== "";
  const lngFilled = lng.trim() !== "";
  if (latFilled !== lngFilled) {
    return "Latitude and longitude must both be provided or both left empty.";
  }
  if (latFilled && parseCoord(lat) === null) return "Latitude must be a valid number.";
  if (lngFilled && parseCoord(lng) === null) return "Longitude must be a valid number.";
  return null;
}

export function LocationForm({
  orgId,
  initial,
  onClose,
  onSuccess,
  travelLegs,
}: {
  orgId: string;
  initial?: LocationFormInitial;
  onClose: () => void;
  onSuccess: () => void;
  travelLegs: Array<{ id: string; name: string; color: string }>;
}) {
  const isEdit = Boolean(initial?.id);
  const [fields, setFields] = useState<LocationFormFields>({
    ...EMPTY,
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: keyof LocationFormFields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFields((prev) => ({ ...prev, [key]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fields.label.trim()) {
      setError("Label is required.");
      return;
    }
    const cErr = coordError(fields.lat, fields.lng);
    if (cErr) {
      setError(cErr);
      return;
    }
    setSaving(true);
    setError(null);
    const body = toBody(fields);
    const path = isEdit
      ? `/organizations/${orgId}/locations/${initial!.id}`
      : `/organizations/${orgId}/locations`;
    const method = isEdit ? "PATCH" : "POST";
    try {
      const res = await apiFetch(path, {
        method,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as any;
        throw new Error(data?.error ?? `API ${res.status}`);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save location.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "rounded-md border border-slate-300 px-3 py-2 text-sm font-normal placeholder:text-slate-400 focus:border-orange-500 focus:outline-none";

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="text-xl font-bold">
          {isEdit ? "Edit location" : "Add location"}
        </h2>

        <form className="mt-4 grid gap-3" onSubmit={handleSubmit}>
          {/* Label */}
          <label className="grid gap-1 text-sm font-semibold">
            Label <span className="text-rose-600">*</span>
            <input
              className={inputCls}
              placeholder="e.g. Main Stage"
              required
              value={fields.label}
              onChange={set("label")}
            />
          </label>

          {/* Venue name */}
          <label className="grid gap-1 text-sm font-semibold">
            Venue name
            <input
              className={inputCls}
              placeholder="Optional venue / hall name"
              value={fields.venueName}
              onChange={set("venueName")}
            />
          </label>

          {/* Address */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">
              Address line 1
              <input
                className={inputCls}
                placeholder="Street address"
                value={fields.address1}
                onChange={set("address1")}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Address line 2
              <input
                className={inputCls}
                placeholder="Suite / unit / bldg"
                value={fields.address2}
                onChange={set("address2")}
              />
            </label>
          </div>

          {/* City / Region / Postal */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold">
              City
              <input
                className={inputCls}
                placeholder="City"
                value={fields.city}
                onChange={set("city")}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              State / Region
              <input
                className={inputCls}
                placeholder="e.g. CO"
                value={fields.region}
                onChange={set("region")}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Postal code
              <input
                className={inputCls}
                placeholder="Zip / postal"
                value={fields.postalCode}
                onChange={set("postalCode")}
              />
            </label>
          </div>

          {/* Website -- free-text; server normalizes to https:// on save */}
          <label className="grid gap-1 text-sm font-semibold">
            Local website
            <input
              className={inputCls}
              placeholder="example.com or https://example.com"
              value={fields.website}
              onChange={set("website")}
            />
            <span className="text-xs font-normal text-slate-500">
              A scheme (https://) is added automatically if omitted.
            </span>
          </label>

          {/* Phone / Email */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">
              Local phone
              <input
                className={inputCls}
                placeholder="(303) 555-0100"
                type="tel"
                value={fields.phone}
                onChange={set("phone")}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Local email
              <input
                className={inputCls}
                placeholder="info@venue.com"
                type="email"
                value={fields.email}
                onChange={set("email")}
              />
            </label>
          </div>

          {/* Local status */}
          <label className="grid gap-1 text-sm font-semibold">
            Local status
            <input
              className={inputCls}
              placeholder="e.g. interested, confirmed, declined"
              value={fields.localStatus}
              onChange={set("localStatus")}
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold">
            Travel leg
            <select
              className={inputCls}
              value={fields.travelLegId}
              onChange={set("travelLegId")}
            >
              <option value="">Unassigned</option>
              {travelLegs.map((leg) => (
                <option key={leg.id} value={leg.id}>{leg.name}</option>
              ))}
            </select>
            <span className="text-xs font-normal text-slate-500">
              Planning default for this location; existing bookings keep their own leg.
            </span>
          </label>

          {/* Coordinates -- both required or both empty */}
          <fieldset className="grid gap-1">
            <legend className="text-sm font-semibold">
              Coordinates{" "}
              <span className="font-normal text-slate-500">(optional -- both or neither)</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold">
                Latitude
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="e.g. 39.7392"
                  value={fields.lat}
                  onChange={set("lat")}
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Longitude
                <input
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="e.g. -104.9903"
                  value={fields.lng}
                  onChange={set("lng")}
                />
              </label>
            </div>
          </fieldset>

          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          )}

          <div className="mt-2 flex justify-end gap-3">
            <button
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              disabled={saving}
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add location"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
