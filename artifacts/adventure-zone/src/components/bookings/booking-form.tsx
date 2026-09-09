"use client";

import { useLocation } from "wouter";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  bookingEditInputSchema,
  bookingInputSchema,
  type BookingEditInput,
  type BookingFormInput,
} from "@/features/bookings/booking-input";
import {
  bookingStatusValues,
  probabilityValues,
  type BookingStatus,
  type Probability,
} from "@/features/bookings/booking-types";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";
import { deleteDraft, loadDraft, saveDraft } from "@/lib/offline/draft-store";
import { geocodeAddressAction, type GeocodeCandidate } from "@/actions/trips";

type GeoState = { loading: boolean; error: string | null; candidates: GeocodeCandidate[] };
const geoInit: GeoState = { loading: false, error: null, candidates: [] };

const locationFieldNames = new Set([
  "venueName",
  "address1",
  "city",
  "region",
  "postalCode",
]);

const westernStateNames: Record<string, string> = {
  AZ: "arizona",
  CO: "colorado",
  ID: "idaho",
  MT: "montana",
  ND: "north dakota",
  NM: "new mexico",
  NV: "nevada",
  OR: "oregon",
  SD: "south dakota",
  UT: "utah",
  WA: "washington",
  WY: "wyoming",
};

function candidateMatchesBooking(
  displayName: string,
  city: string,
  region: string,
) {
  const normalizedDisplay = displayName.toLowerCase();
  const normalizedCity = city.trim().toLowerCase();
  const normalizedRegion = region.trim().toUpperCase();
  const cityMatches =
    !normalizedCity || normalizedDisplay.includes(normalizedCity);
  const stateName = westernStateNames[normalizedRegion];
  const stateCodeMatches = new RegExp(
    `(^|[^a-z])${normalizedRegion.toLowerCase()}([^a-z]|$)`,
  ).test(normalizedDisplay);
  const stateMatches =
    !normalizedRegion ||
    stateCodeMatches ||
    (stateName ? normalizedDisplay.includes(stateName) : true);
  return cityMatches && stateMatches;
}

type BookingSubmissionResult =
  | { ok: true }
  | { ok: false; error: string }
  | void;

type BookingFormValues = {
  name: string;
  venueName: string;
  address1: string;
  city: string;
  region: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  probability: Probability;
  travelLegId: string;
  notes: string;
  nextActionKind: string;
  nextActionDueAt: string;
};

type SharedBookingFormProps = {
  draftKey?: string;
  initialValues?: Partial<BookingFormValues>;
  successPath?: string;
  travelLegs?: TravelLeg[];
};

type CreateBookingFormProps = SharedBookingFormProps & {
  variant?: "create";
  onSubmit: (
    input: BookingFormInput,
  ) => BookingSubmissionResult | Promise<BookingSubmissionResult>;
};

type EditBookingFormProps = SharedBookingFormProps & {
  variant: "edit";
  onSubmit: (
    input: BookingEditInput,
  ) => BookingSubmissionResult | Promise<BookingSubmissionResult>;
};

type BookingFormProps = CreateBookingFormProps | EditBookingFormProps;

type TravelLegSelectProps = {
  name: string;
  value: string;
  travelLegs: TravelLeg[];
  onChange: (value: string) => void;
};

function TravelLegSelect({
  name,
  value,
  travelLegs,
  onChange,
}: TravelLegSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedLeg = travelLegs.find((l) => l.id === value) ?? null;
  // Archived legs are not selectable, but an archived leg already attached to
  // this booking keeps rendering (both as the selection and as an option).
  const selectableLegs = travelLegs.filter(
    (leg) => !leg.archivedAt || leg.id === value,
  );

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Escape") setOpen(false);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }

  function selectOption(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Hidden input so FormData picks up the value */}
      <input type="hidden" name={name} value={value} />

      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        type="button"
      >
        {selectedLeg ? (
          <>
            <span
              aria-hidden="true"
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ backgroundColor: selectedLeg.color }}
            />
            <span>{selectedLeg.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
        <svg
          aria-hidden="true"
          className="ml-auto size-4 shrink-0 opacity-50"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-input bg-background py-1 shadow-md"
          role="listbox"
        >
          <li
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
            onClick={() => selectOption("")}
            role="option"
            aria-selected={value === ""}
          >
            <span className="inline-block size-3 shrink-0 rounded-full border border-dashed border-muted-foreground opacity-40" />
            <span className="text-muted-foreground">Unassigned</span>
          </li>
          {selectableLegs.map((leg) => (
            <li
              key={leg.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
              onClick={() => selectOption(leg.id)}
              role="option"
              aria-selected={value === leg.id}
            >
              <span
                aria-hidden="true"
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: leg.color }}
              />
              <span>{leg.name}</span>
              {leg.archivedAt ? (
                <span className="text-xs text-muted-foreground">
                  (archived)
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const defaultValues: BookingFormValues = {
  name: "",
  venueName: "",
  address1: "",
  city: "",
  region: "",
  postalCode: "",
  latitude: "",
  longitude: "",
  startsAt: "",
  endsAt: "",
  status: "new_lead",
  probability: "possible",
  travelLegId: "",
  notes: "",
  nextActionKind: "",
  nextActionDueAt: "",
};

export function BookingForm(props: BookingFormProps) {
  const { initialValues } = props;
  const [, navigate] = useLocation();
  const draftKey =
    props.draftKey ??
    (props.variant === "edit" ? "booking:edit" : "booking:new");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverSaveConfirmed, setServerSaveConfirmed] = useState(false);
  const [values, setValues] = useState<BookingFormValues>(() => ({
    ...defaultValues,
    ...initialValues,
  }));
  const [restorableDraft, setRestorableDraft] =
    useState<BookingFormValues | null>(null);
  const [isLocalDraft, setIsLocalDraft] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [geo, setGeo] = useState<GeoState>(geoInit);
  const [selectedGeoLabel, setSelectedGeoLabel] = useState<string | null>(
    initialValues?.latitude && initialValues?.longitude
      ? "Saved map location"
      : null,
  );
  const [locationWarning, setLocationWarning] = useState("");

  async function findCoordinates() {
    const query = [
      values.venueName,
      values.address1,
      values.city,
      values.region,
      values.postalCode,
    ]
      .filter((part) => part.trim())
      .join(", ")
      .trim();
    if (!values.city.trim() || !values.region.trim()) {
      setGeo({
        loading: false,
        error: "Enter the event city and state before mapping it.",
        candidates: [],
      });
      return;
    }
    setGeo({ loading: true, error: null, candidates: [] });
    const result = await geocodeAddressAction(query);
    if (result.ok) {
      setGeo({ loading: false, error: null, candidates: result.results });
    } else {
      setGeo({ loading: false, error: result.error, candidates: [] });
    }
  }

  function pickGeoCandidate(candidate: GeocodeCandidate) {
    const nextValues = {
      ...values,
      latitude: String(candidate.latitude),
      longitude: String(candidate.longitude),
    };
    setValues(nextValues);
    setGeo(geoInit);
    setSelectedGeoLabel(candidate.displayName);
    setLocationWarning(
      candidateMatchesBooking(
        candidate.displayName,
        values.city,
        values.region,
      )
        ? ""
        : `This result does not appear to match ${values.city}, ${values.region.toUpperCase()}. Check it before saving.`,
    );
    if (!navigator.onLine) persistDraft(nextValues);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const draft = loadDraft<Partial<BookingFormValues>>(draftKey);
      if (draft) {
        setRestorableDraft({ ...defaultValues, ...draft });
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [draftKey]);

  function persistDraft(nextValues: BookingFormValues) {
    const result = saveDraft(draftKey, nextValues);
    if (result.ok) {
      setIsLocalDraft(true);
      setDraftError("");
      return true;
    }

    setDraftError("Draft could not be saved on this device");
    return false;
  }

  function handleChange(
    event: ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) {
    const { name, value } = event.currentTarget;
    const locationChanged =
      locationFieldNames.has(name) &&
      value !== values[name as keyof BookingFormValues];
    const nextValues = locationChanged
      ? { ...values, [name]: value, latitude: "", longitude: "" }
      : { ...values, [name]: value };
    if (locationChanged) {
      setGeo(geoInit);
      setSelectedGeoLabel(null);
      setLocationWarning("Location changed — choose coordinates again.");
    }
    setValues(nextValues);
    if (!navigator.onLine) {
      persistDraft(nextValues);
    }
  }

  function restoreDraft() {
    if (!restorableDraft) return;
    setValues(restorableDraft);
    setRestorableDraft(null);
    setIsLocalDraft(true);
    setDraftError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (serverSaveConfirmed) return;
    const formData = new FormData(event.currentTarget);
    const rawInput = Object.fromEntries(formData);
    const result =
      props.variant === "edit"
        ? bookingEditInputSchema.safeParse(rawInput)
        : bookingInputSchema.safeParse(rawInput);

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      if (
        props.variant === "edit" &&
        rawInput.status === "confirmed" &&
        (!String(rawInput.latitude ?? "").trim() ||
          !String(rawInput.longitude ?? "").trim())
      ) {
        setLocationWarning("Map this confirmed event before saving.");
        void findCoordinates();
      }
      return;
    }

    setErrors({});
    setSubmissionError("");
    setIsSubmitting(true);
    let navigateTo: string | undefined;
    try {
      const submissionResult =
        props.variant === "edit"
          ? await props.onSubmit(result.data as BookingEditInput)
          : await props.onSubmit(result.data as BookingFormInput);
      if (!submissionResult) {
        if (persistDraft(values)) {
          setSubmissionError(
            "Save was not confirmed. Your changes are saved as a local draft, not on the server.",
          );
        }
      } else if (!submissionResult.ok) {
        persistDraft(values);
        setSubmissionError(submissionResult.error);
      } else {
        setServerSaveConfirmed(true);
        setIsLocalDraft(false);
        setRestorableDraft(null);
        const deletion = deleteDraft(draftKey);
        if (deletion.ok) {
          navigateTo = props.successPath;
        } else {
          setDraftError(
            "Saved on the server, but the stale local draft could not be removed from this device. It will not be offered for restore in this session.",
          );
          navigateTo = props.successPath;
        }
      }
    } catch {
      if (persistDraft(values)) {
        setSubmissionError(
          "Connection lost. Your changes are saved as a local draft, not on the server.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
    if (navigateTo) {
      navigate(navigateTo);
    }
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={handleSubmit}>
      {restorableDraft ? (
        <div className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 sm:flex-row sm:items-center sm:justify-between">
          <p>A local unsaved draft is available on this device.</p>
          <button
            className="button-secondary shrink-0"
            onClick={restoreDraft}
            type="button"
          >
            Restore draft
          </button>
        </div>
      ) : null}
      {isLocalDraft ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">
          Local draft — not saved
        </p>
      ) : null}
      {draftError ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
          role="alert"
        >
          {draftError}
        </p>
      ) : null}
      {submissionError ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800"
          role="alert"
        >
          {submissionError}
        </p>
      ) : null}
      <label className="grid gap-1.5 font-medium">
        Event name
        <input
          name="name"
          onChange={handleChange}
          type="text"
          value={values.name}
        />
        {errors.name ? <span role="alert">{errors.name}</span> : null}
      </label>

      {props.variant === "edit" ? (
        <>
          <label className="grid gap-1.5 font-medium">
            Venue
            <input
              name="venueName"
              onChange={handleChange}
              type="text"
              value={values.venueName}
            />
          </label>

          <label className="grid gap-1.5 font-medium">
            Street address
            <input
              name="address1"
              onChange={handleChange}
              type="text"
              value={values.address1}
            />
          </label>
        </>
      ) : null}

      <label className="grid gap-1.5 font-medium">
        City
        <input
          name="city"
          onChange={handleChange}
          type="text"
          value={values.city}
        />
        {errors.city ? <span role="alert">{errors.city}</span> : null}
      </label>

      <label className="grid gap-1.5 font-medium">
        State
        <input
          maxLength={2}
          name="region"
          onChange={handleChange}
          type="text"
          value={values.region}
        />
        {errors.region ? <span role="alert">{errors.region}</span> : null}
      </label>

      {props.variant === "edit" ? (
        <>
          <label className="grid gap-1.5 font-medium">
            Postal code
            <input
              name="postalCode"
              onChange={handleChange}
              type="text"
              value={values.postalCode}
            />
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-1.5 font-medium">
              Start date
              <input
                name="startsAt"
                onChange={handleChange}
                type="date"
                value={values.startsAt}
              />
              {errors.startsAt ? (
                <span role="alert">{errors.startsAt}</span>
              ) : null}
            </label>
            <label className="grid gap-1.5 font-medium">
              End date
              <input
                name="endsAt"
                onChange={handleChange}
                type="date"
                value={values.endsAt}
              />
              {errors.endsAt ? <span role="alert">{errors.endsAt}</span> : null}
            </label>
          </div>
        </>
      ) : null}

      <label className="grid gap-1.5 font-medium">
        Status
        <select name="status" onChange={handleChange} value={values.status}>
          {bookingStatusValues.map((status) => (
            <option key={status} value={status}>
              {status.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5 font-medium">
        Probability
        <select
          name="probability"
          onChange={handleChange}
          value={values.probability}
        >
          {probabilityValues.map((probability) => (
            <option key={probability} value={probability}>
              {probability}
            </option>
          ))}
        </select>
      </label>

      {props.variant === "edit" ? (
        <>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">Coordinates</span>
              <button
                className="button-secondary text-sm"
                disabled={geo.loading}
                onClick={findCoordinates}
                type="button"
              >
                {geo.loading ? "Finding…" : "Find coordinates"}
              </button>
            </div>
            {geo.error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {geo.error}
              </p>
            ) : null}
            {locationWarning ? (
              <p
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950"
                role="alert"
              >
                {locationWarning}
              </p>
            ) : null}
            {selectedGeoLabel ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                <p className="font-semibold">Mapped to {selectedGeoLabel}</p>
                <a
                  className="mt-1 inline-block text-xs font-bold underline"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${values.latitude},${values.longitude}`,
                  )}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  Preview pin
                </a>
              </div>
            ) : null}
            {geo.candidates.length > 0 ? (
              <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-sm shadow-sm">
                {geo.candidates.map((candidate) => (
                  <li key={`${candidate.latitude},${candidate.longitude}`}>
                    <button
                      className="w-full px-3 py-2 text-left hover:bg-orange-50 focus:bg-orange-50 focus:outline-none"
                      onClick={() => pickGeoCandidate(candidate)}
                      type="button"
                    >
                      <span className="block font-medium text-slate-900 truncate">{candidate.displayName}</span>
                      <span className="block text-xs text-slate-500">
                        {candidate.latitude.toFixed(5)}, {candidate.longitude.toFixed(5)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="grid gap-1.5 font-medium">
                Latitude
                <input
                  inputMode="decimal"
                  name="latitude"
                  onChange={handleChange}
                  type="text"
                  value={values.latitude}
                />
                {errors.latitude ? (
                  <span role="alert">{errors.latitude}</span>
                ) : null}
              </label>
              <label className="grid gap-1.5 font-medium">
                Longitude
                <input
                  inputMode="decimal"
                  name="longitude"
                  onChange={handleChange}
                  type="text"
                  value={values.longitude}
                />
                {errors.longitude ? (
                  <span role="alert">{errors.longitude}</span>
                ) : null}
              </label>
            </div>
          </div>

          <div className="grid gap-1.5 font-medium">
            Travel leg
            <TravelLegSelect
              name="travelLegId"
              onChange={(id) => {
                const nextValues = { ...values, travelLegId: id };
                setValues(nextValues);
                if (!navigator.onLine) persistDraft(nextValues);
              }}
              travelLegs={props.travelLegs ?? []}
              value={values.travelLegId}
            />
          </div>

          <label className="grid gap-1.5 font-medium">
            Notes
            <textarea
              name="notes"
              onChange={handleChange}
              rows={5}
              value={values.notes}
            />
          </label>
        </>
      ) : null}

      {props.variant !== "edit" ? (
        <>
          <label className="grid gap-1.5 font-medium">
            Next action
            <select
              name="nextActionKind"
              onChange={handleChange}
              value={values.nextActionKind}
            >
              <option value="">Choose an action</option>
              <option value="call">Call</option>
              <option value="send_information">Send information</option>
              <option value="prepare_quote">Prepare quote</option>
              <option value="check_contract">Check on contract</option>
            </select>
            {errors.nextActionKind ? (
              <span role="alert">{errors.nextActionKind}</span>
            ) : null}
          </label>

          <label className="grid gap-1.5 font-medium">
            Follow-up date
            <input
              name="nextActionDueAt"
              onChange={handleChange}
              type="date"
              value={values.nextActionDueAt}
            />
            {errors.nextActionDueAt ? (
              <span role="alert">{errors.nextActionDueAt}</span>
            ) : null}
          </label>
        </>
      ) : null}

      <button disabled={isSubmitting || serverSaveConfirmed} type="submit">
        {serverSaveConfirmed
          ? "Saved"
          : isSubmitting
            ? "Saving…"
            : props.variant === "edit"
              ? "Save changes"
              : "Save lead"}
      </button>
    </form>
  );
}
