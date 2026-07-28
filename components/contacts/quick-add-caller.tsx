"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type {
  PhoneMatch,
} from "@/features/contacts/contact-types";

type QuickAddSubmission =
  | { ok: true; contactId: string }
  | { ok: false; error: string };

type QuickAddCallerForm = {
  name: string;
  organizationName: string;
  phone: string;
  email: string;
  reason: string;
  eventDate: string;
  eventLocation: string;
};

function callerName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim() || "Unnamed caller";
}

export function QuickAddCaller({
  match,
  initialPhone = "",
  onSubmit,
}: {
  match: PhoneMatch;
  initialPhone?: string;
  onSubmit?: (input: QuickAddCallerForm) => Promise<QuickAddSubmission> | QuickAddSubmission;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    if (!values.phone?.trim() && !values.email?.trim()) {
      setError("Enter a phone number or email address.");
      return;
    }
    if (!onSubmit) {
      setError("The caller form is unavailable. Try again.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const result = await onSubmit({
        name: values.name ?? "",
        organizationName: values.organizationName ?? "",
        phone: values.phone?.trim() ?? "",
        email: values.email?.trim() ?? "",
        reason: values.reason ?? "",
        eventDate: values.eventDate?.trim() ?? "",
        eventLocation: values.eventLocation?.trim() ?? "",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/calls/new?contactId=${result.contactId}`);
    } catch {
      setError("The caller could not be created. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (match.kind === "one") {
    return (
      <section aria-labelledby="caller-match-title" className="grid gap-4">
        <h2 className="text-xl font-bold" id="caller-match-title">Caller match found</h2>
        <p className="text-slate-600">This phone number belongs to {callerName(match.contact.firstName, match.contact.lastName)}.</p>
        <Link className="button-primary w-fit" href={`/calls/new?contactId=${match.contact.id}`}>
          Open {callerName(match.contact.firstName, match.contact.lastName)} in Call Workspace
        </Link>
      </section>
    );
  }

  if (match.kind === "many") {
    return (
      <section aria-labelledby="caller-chooser-title" className="grid gap-4">
        <h2 className="text-xl font-bold" id="caller-chooser-title">Choose the caller</h2>
        <p className="text-slate-600">More than one contact has this exact phone number.</p>
        <ul className="grid gap-2">
          {match.contacts.map((contact) => (
            <li key={contact.id}>
              <Link className="block rounded-lg border border-slate-200 p-4 font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600" href={`/calls/new?contactId=${contact.id}`}>
                Open {callerName(contact.firstName, contact.lastName)} in Call Workspace
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <form className="grid gap-5" noValidate onSubmit={submit}>
      <div>
        <h2 className="text-xl font-bold">New caller</h2>
        <p className="mt-1 text-slate-600">No exact phone match was found. Capture the essentials to start a call note.</p>
      </div>
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-1.5 font-medium sm:col-span-2">
          Name
          <input autoComplete="name" name="name" required />
        </label>
        <label className="grid gap-1.5 font-medium sm:col-span-2">
          Organization or event
          <input autoComplete="organization" name="organizationName" required />
        </label>
        <label className="grid gap-1.5 font-medium">
          Phone
          <input autoComplete="tel" defaultValue={initialPhone} name="phone" type="tel" />
        </label>
        <label className="grid gap-1.5 font-medium">
          Email
          <input autoComplete="email" name="email" type="email" />
        </label>
        <label className="grid gap-1.5 font-medium sm:col-span-2">
          Reason for calling
          <textarea name="reason" required rows={3} />
        </label>
        <label className="grid gap-1.5 font-medium">
          Event date (optional)
          <input name="eventDate" type="date" />
        </label>
        <label className="grid gap-1.5 font-medium">
          Event location (optional)
          <input autoComplete="address-level2" name="eventLocation" />
        </label>
      </div>
      <div><button className="button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Creating…" : "Create caller"}</button></div>
    </form>
  );
}
