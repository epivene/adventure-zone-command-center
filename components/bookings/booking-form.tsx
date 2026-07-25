"use client";

import { useState, type FormEvent } from "react";

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
  initialValues?: Partial<BookingFormValues>;
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const values = { ...defaultValues, ...initialValues };

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
    try {
      const submissionResult =
        props.variant === "edit"
          ? await props.onSubmit(result.data as BookingEditInput)
          : await props.onSubmit(result.data as BookingFormInput);
      if (submissionResult && !submissionResult.ok) {
        setSubmissionError(submissionResult.error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={handleSubmit}>
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
        <input defaultValue={values.name} name="name" type="text" />
        {errors.name ? <span role="alert">{errors.name}</span> : null}
      </label>

      <label className="grid gap-1.5 font-medium">
        City
        <input defaultValue={values.city} name="city" type="text" />
        {errors.city ? <span role="alert">{errors.city}</span> : null}
      </label>

      <label className="grid gap-1.5 font-medium">
        State
        <input defaultValue={values.region} maxLength={2} name="region" type="text" />
        {errors.region ? <span role="alert">{errors.region}</span> : null}
      </label>

      {props.variant !== "edit" ? (
        <label className="grid gap-1.5 font-medium">
          Status
          <select defaultValue={values.status} name="status">
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
        <select defaultValue={values.probability} name="probability">
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
            <select defaultValue={values.nextActionKind} name="nextActionKind">
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
              defaultValue={values.nextActionDueAt}
              name="nextActionDueAt"
              type="date"
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
