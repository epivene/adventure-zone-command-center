"use client";

import { Link } from "wouter";
import { useLocation } from "wouter";
import { useRef, useState, type FormEvent } from "react";

import type {
  PhoneMatch,
} from "@/features/contacts/contact-types";

type QuickAddSubmission =
  | { ok: true; contactId: string }
  | { ok: false; error: string }
  | { ok: false; match: PhoneMatch };

type QuickAddCallerForm = {
  name: string;
  organizationName: string;
  phone: string;
  email: string;
  reason: string;
  eventDate: string;
  eventLocation: string;
};
type QuickAddCallerSubmission = QuickAddCallerForm & { requestKey: string };

function callerName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim() || "Unnamed caller";
}

function emptyMatch(): PhoneMatch {
  return { kind: "none", normalizedPhone: "" };
}

export function QuickAddCaller({
  match,
  initialPhone = "",
  onSubmit,
}: {
  match: PhoneMatch;
  initialPhone?: string;
  onSubmit?: (input: QuickAddCallerSubmission) => Promise<QuickAddSubmission> | QuickAddSubmission;
}) {
  const [, navigate] = useLocation();
  const [error, setError] = useState("");
  const requestKey = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resolvedMatch, setResolvedMatch] = useState(match);
  const [values, setValues] = useState<QuickAddCallerForm>({
    name: "",
    organizationName: "",
    phone: initialPhone,
    email: "",
    reason: "",
    eventDate: "",
    eventLocation: "",
  });

  function updateValue(name: keyof QuickAddCallerForm, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.phone.trim() && !values.email.trim()) {
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
        requestKey: requestKey.current ??= crypto.randomUUID(),
        name: values.name,
        organizationName: values.organizationName,
        phone: values.phone.trim(),
        email: values.email.trim(),
        reason: values.reason,
        eventDate: values.eventDate.trim(),
        eventLocation: values.eventLocation.trim(),
      });
      if (!result.ok) {
        if ("match" in result) {
          setResolvedMatch(result.match);
          return;
        }
        setError(result.error);
        return;
      }
      navigate(`/calls/new?contactId=${result.contactId}`);
    } catch {
      setError("The caller could not be created. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (resolvedMatch.kind === "one") {
    return (
      <section aria-labelledby="caller-match-title" className="grid gap-4">
        <h2 className="text-xl font-bold" id="caller-match-title">Caller match found</h2>
        <p className="text-slate-600">This phone number belongs to {callerName(resolvedMatch.contact.firstName, resolvedMatch.contact.lastName)}.</p>
        <Link className="button-primary w-fit" href={`/calls/new?contactId=${resolvedMatch.contact.id}`}>
          Open {callerName(resolvedMatch.contact.firstName, resolvedMatch.contact.lastName)} in Call Workspace
        </Link>
        <button className="button-secondary w-fit" onClick={() => setResolvedMatch(emptyMatch())} type="button">Back to caller details</button>
      </section>
    );
  }

  if (resolvedMatch.kind === "many") {
    return (
      <section aria-labelledby="caller-chooser-title" className="grid gap-4">
        <h2 className="text-xl font-bold" id="caller-chooser-title">Choose the caller</h2>
        <p className="text-slate-600">More than one contact has this exact phone number.</p>
        <ul className="grid gap-2">
          {resolvedMatch.contacts.map((contact) => (
            <li key={contact.id}>
              <Link className="block rounded-lg border border-slate-200 p-4 font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600" href={`/calls/new?contactId=${contact.id}`}>
                Open {callerName(contact.firstName, contact.lastName)} in Call Workspace
              </Link>
            </li>
          ))}
        </ul>
        <button className="button-secondary w-fit" onClick={() => setResolvedMatch(emptyMatch())} type="button">Back to caller details</button>
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
          <input autoComplete="name" name="name" onChange={(event) => updateValue("name", event.target.value)} required value={values.name} />
        </label>
        <label className="grid gap-1.5 font-medium sm:col-span-2">
          Organization or event
          <input autoComplete="organization" name="organizationName" onChange={(event) => updateValue("organizationName", event.target.value)} required value={values.organizationName} />
        </label>
        <label className="grid gap-1.5 font-medium">
          Phone
          <input autoComplete="tel" name="phone" onChange={(event) => updateValue("phone", event.target.value)} type="tel" value={values.phone} />
        </label>
        <label className="grid gap-1.5 font-medium">
          Email
          <input autoComplete="email" name="email" onChange={(event) => updateValue("email", event.target.value)} type="email" value={values.email} />
        </label>
        <label className="grid gap-1.5 font-medium sm:col-span-2">
          Reason for calling
          <textarea name="reason" onChange={(event) => updateValue("reason", event.target.value)} required rows={3} value={values.reason} />
        </label>
        <label className="grid gap-1.5 font-medium">
          Event date (optional)
          <input name="eventDate" onChange={(event) => updateValue("eventDate", event.target.value)} type="date" value={values.eventDate} />
        </label>
        <label className="grid gap-1.5 font-medium">
          Event location (optional)
          <input autoComplete="address-level2" name="eventLocation" onChange={(event) => updateValue("eventLocation", event.target.value)} value={values.eventLocation} />
        </label>
      </div>
      <div><button className="button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Creating…" : "Create caller"}</button></div>
    </form>
  );
}
