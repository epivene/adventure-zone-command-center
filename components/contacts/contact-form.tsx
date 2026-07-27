"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  contactFormInputSchema,
  type ContactFormInput,
  type ContactInput,
} from "@/features/contacts/contact-input";

type ContactSubmissionResult =
  | { ok: true; contactId?: string }
  | { ok: false; error: string }
  | void;

type ContactFormValues = Record<keyof ContactInput, string>;

const emptyValues: ContactFormValues = {
  firstName: "",
  lastName: "",
  organizationName: "",
  jobTitle: "",
  email: "",
  phone: "",
  address1: "",
  address2: "",
  city: "",
  region: "",
  postalCode: "",
};

export function ContactForm({
  initialValues = {},
  onSubmit,
  successPath,
  variant = "create",
}: {
  initialValues?: Partial<ContactFormInput>;
  onSubmit: (
    input: ContactInput,
  ) => ContactSubmissionResult | Promise<ContactSubmissionResult>;
  successPath: string;
  variant?: "create" | "edit";
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const values = {
    ...emptyValues,
    ...Object.fromEntries(
      Object.entries(initialValues).map(([key, value]) => [key, value ?? ""]),
    ),
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = contactFormInputSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
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
      const result = await onSubmit(parsed.data);
      if (!result) {
        setSubmissionError("The server did not confirm this save.");
      } else if (!result.ok) {
        setSubmissionError(result.error);
      } else {
        router.push(
          variant === "create" && result.contactId
            ? `/contacts/${result.contactId}`
            : successPath,
        );
      }
    } catch {
      setSubmissionError("The contact could not be saved. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const fields: {
    name: keyof ContactFormValues;
    label: string;
    type?: string;
    autoComplete?: string;
  }[] = [
    { name: "firstName", label: "First name", autoComplete: "given-name" },
    { name: "lastName", label: "Last name", autoComplete: "family-name" },
    { name: "organizationName", label: "Organization", autoComplete: "organization" },
    { name: "jobTitle", label: "Job title", autoComplete: "organization-title" },
    { name: "email", label: "Email", type: "email", autoComplete: "email" },
    { name: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
    { name: "address1", label: "Address line 1", autoComplete: "address-line1" },
    { name: "address2", label: "Address line 2", autoComplete: "address-line2" },
    { name: "city", label: "City", autoComplete: "address-level2" },
    { name: "region", label: "State", autoComplete: "address-level1" },
    { name: "postalCode", label: "ZIP code", autoComplete: "postal-code" },
  ];

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
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <label
            className={`grid gap-1.5 font-medium ${
              field.name === "address1" || field.name === "address2"
                ? "sm:col-span-2"
                : ""
            }`}
            key={field.name}
          >
            {field.label}
            <input
              autoComplete={field.autoComplete}
              defaultValue={values[field.name]}
              name={field.name}
              type={field.type ?? "text"}
            />
            {errors[field.name] ? (
              <span className="text-sm text-rose-700" role="alert">
                {errors[field.name]}
              </span>
            ) : null}
          </label>
        ))}
      </div>
      <div>
        <button className="button-primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving…" : "Save contact"}
        </button>
      </div>
    </form>
  );
}
