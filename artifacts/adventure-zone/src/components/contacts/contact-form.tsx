"use client";

import { useLocation } from "wouter";
import { useState, type FormEvent } from "react";

import {
  contactFormInputSchema,
  type ContactFormInput,
  type ContactInput,
} from "@/features/contacts/contact-input";
import type { ContactPhoneInput, ContactPhoneType } from "@/features/contact-phones/contact-phone-types";

type ContactSubmissionResult =
  | { ok: true; contactId?: string }
  | { ok: false; error: string }
  | void;

type PhoneSubmissionResult = { ok: true } | { ok: false; error: string } | void;
type ContactFormValues = Record<keyof ContactInput, string>;
const phoneTypes: ContactPhoneType[] = ["mobile", "office", "alternate", "unknown"];

const emptyValues: ContactFormValues = {
  firstName: "", lastName: "", organizationName: "", jobTitle: "", email: "", phone: "",
  address1: "", address2: "", city: "", region: "", postalCode: "",
};

export function ContactPhoneFields({
  phones,
  onChange,
}: {
  phones: ContactPhoneInput[];
  onChange: (phones: ContactPhoneInput[]) => void;
}) {
  const update = (index: number, patch: Partial<ContactPhoneInput>) =>
    onChange(phones.map((phone, current) => current === index ? { ...phone, ...patch } : phone));

  return (
    <fieldset className="grid gap-3 sm:col-span-2">
      <legend className="font-medium">Phone numbers</legend>
      {phones.map((phone, index) => (
        <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-6" key={phone.id ?? `new-${index}`}>
          <input aria-label="Phone number" value={phone.number} onChange={(event) => update(index, { number: event.target.value })} type="tel" className="sm:col-span-2" />
          <select aria-label="Phone type" value={phone.type} onChange={(event) => update(index, { type: event.target.value as ContactPhoneType })}>
            {phoneTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input aria-label="Phone extension" placeholder="Extension" value={phone.extension ?? ""} onChange={(event) => update(index, { extension: event.target.value || null })} />
          <input aria-label="Phone label" placeholder="Label" value={phone.label ?? ""} onChange={(event) => update(index, { label: event.target.value || null })} />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-sm"><input type="radio" name="primaryPhone" checked={phone.primary} onChange={() => onChange(phones.map((candidate, current) => ({ ...candidate, primary: current === index })))} />Primary</label>
            <button className="text-sm text-rose-700" type="button" onClick={() => onChange(phones.filter((_, current) => current !== index))}>Remove</button>
          </div>
        </div>
      ))}
      <button className="button-secondary w-fit" type="button" onClick={() => onChange([...phones, { id: null, number: "", type: "mobile", extension: null, label: null, primary: phones.length === 0 }])}>Add phone</button>
    </fieldset>
  );
}

export function ContactForm({
  initialValues = {},
  initialPhones = [],
  onSubmit,
  onPhonesSubmit,
  successPath,
  variant = "create",
}: {
  initialValues?: Partial<ContactFormInput>;
  initialPhones?: ContactPhoneInput[];
  onSubmit: (input: ContactInput) => ContactSubmissionResult | Promise<ContactSubmissionResult>;
  onPhonesSubmit?: (phones: ContactPhoneInput[]) => PhoneSubmissionResult | Promise<PhoneSubmissionResult>;
  successPath: string;
  variant?: "create" | "edit";
}) {
  const [, navigate] = useLocation();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phones, setPhones] = useState<ContactPhoneInput[]>(initialPhones);
  const values = { ...emptyValues, ...Object.fromEntries(Object.entries(initialValues).map(([key, value]) => [key, value ?? ""])) };
  const [primaryPhone, setPrimaryPhone] = useState(values.phone);

  function handlePhoneChange(nextPhones: ContactPhoneInput[]) {
    setPhones(nextPhones);
    const primary = nextPhones.find((phone) => phone.primary);
    if (primary) setPrimaryPhone(primary.number);
  }

  function phonesForSubmission(phone: string | null): ContactPhoneInput[] {
    return phones.map((item) => item.primary ? { ...item, number: phone ?? "" } : item);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = contactFormInputSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !fieldErrors[field]) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmissionError("");
    setIsSubmitting(true);
    try {
      const result = await onSubmit(parsed.data);
      if (!result) setSubmissionError("The server did not confirm this save.");
      else if (!result.ok) setSubmissionError(result.error);
      else {
        const phoneResult = onPhonesSubmit ? await onPhonesSubmit(phonesForSubmission(parsed.data.phone)) : ({ ok: true } as const);
        if (!phoneResult || !phoneResult.ok) setSubmissionError(phoneResult?.error ?? "The phone numbers could not be saved.");
        else navigate(variant === "create" && result.contactId ? `/contacts/${result.contactId}` : successPath);
      }
    } catch {
      setSubmissionError("The contact could not be saved. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const fields: { name: keyof ContactFormValues; label: string; type?: string; autoComplete?: string; }[] = [
    { name: "firstName", label: "First name", autoComplete: "given-name" },
    { name: "lastName", label: "Last name", autoComplete: "family-name" },
    { name: "organizationName", label: "Organization", autoComplete: "organization" },
    { name: "jobTitle", label: "Job title", autoComplete: "organization-title" },
    { name: "email", label: "Email", type: "email", autoComplete: "email" },
    { name: "phone", label: "Primary phone", type: "tel", autoComplete: "tel" },
    { name: "address1", label: "Address line 1", autoComplete: "address-line1" },
    { name: "address2", label: "Address line 2", autoComplete: "address-line2" },
    { name: "city", label: "City", autoComplete: "address-level2" },
    { name: "region", label: "State", autoComplete: "address-level1" },
    { name: "postalCode", label: "ZIP code", autoComplete: "postal-code" },
  ];

  return (
    <form className="grid gap-5" noValidate onSubmit={handleSubmit}>
      {submissionError ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{submissionError}</p> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <label className={`grid gap-1.5 font-medium ${field.name === "address1" || field.name === "address2" ? "sm:col-span-2" : ""}`} key={field.name}>
            {field.label}
            <input
              autoComplete={field.autoComplete}
              defaultValue={field.name === "phone" ? undefined : values[field.name]}
              name={field.name}
              onChange={field.name === "phone" ? (event) => setPrimaryPhone(event.target.value) : undefined}
              type={field.type ?? "text"}
              value={field.name === "phone" ? primaryPhone : undefined}
            />
            {errors[field.name] ? <span className="text-sm text-rose-700" role="alert">{errors[field.name]}</span> : null}
          </label>
        ))}
        {onPhonesSubmit ? <ContactPhoneFields phones={phones} onChange={handlePhoneChange} /> : null}
      </div>
      <div><button className="button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : "Save contact"}</button></div>
    </form>
  );
}
