"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
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
import { deleteDraft, loadDraft, saveDraft } from "@/lib/offline/draft-store";

type BookingSubmissionResult =
  | { ok: true }
  | { ok: false; error: string }
  | void;

type BookingFormValues = {
  name: string;
  city: string;
  region: string;
  status: BookingStatus;
  probability: Probability;
  nextActionKind: string;
  nextActionDueAt: string;
};

type SharedBookingFormProps = {
  draftKey?: string;
  initialValues?: Partial<BookingFormValues>;
  successPath?: string;
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

const defaultValues: BookingFormValues = {
  name: "",
  city: "",
  region: "",
  status: "new_lead",
  probability: "possible",
  nextActionKind: "",
  nextActionDueAt: "",
};

export function BookingForm(props: BookingFormProps) {
  const { initialValues } = props;
  const router = useRouter();
  const draftKey =
    props.draftKey ??
    (props.variant === "edit" ? "booking:edit" : "booking:new");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [values, setValues] = useState<BookingFormValues>(() => ({
    ...defaultValues,
    ...initialValues,
  }));
  const [restorableDraft, setRestorableDraft] =
    useState<BookingFormValues | null>(null);
  const [isLocalDraft, setIsLocalDraft] = useState(false);
  const [draftError, setDraftError] = useState("");

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
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = event.currentTarget;
    const nextValues = { ...values, [name]: value };
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
        const deletion = deleteDraft(draftKey);
        if (deletion.ok) {
          setIsLocalDraft(false);
          setRestorableDraft(null);
          navigateTo = props.successPath;
        } else {
          setIsLocalDraft(true);
          setDraftError("Draft could not be removed from this device");
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
      router.push(navigateTo);
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

      {props.variant !== "edit" ? (
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
      ) : null}

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

      <button disabled={isSubmitting} type="submit">
        {isSubmitting
          ? "Saving…"
          : props.variant === "edit"
            ? "Save changes"
            : "Save lead"}
      </button>
    </form>
  );
}
