"use client";

import { Link, useLocation } from "wouter";
import { useRef, useState, type FormEvent } from "react";

import type { PhoneMatch } from "@/features/contacts/contact-types";

type DuplicateCandidate = {
  contactId: string;
  name: string;
  organizationName: string | null;
  city: string | null;
  region: string | null;
  reasons: string[];
  kind: "exact" | "likely";
};

type QuickAddSubmission =
  | { ok: true; contactId: string }
  | { ok: false; error: string }
  | {
      ok: false;
      candidates: DuplicateCandidate[];
      canContinueCreating: boolean;
    };

type QuickAddCallerForm = {
  name: string;
  organizationName: string;
  phone: string;
  email: string;
  reason: string;
  eventDate: string;
  eventLocation: string;
};

export type QuickAddCallerSubmission = QuickAddCallerForm & {
  requestKey: string;
  continueCreating: boolean;
};

function callerName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim() || "Unnamed caller";
}

function emptyMatch(): PhoneMatch {
  return { kind: "none", normalizedPhone: "" };
}

function callWorkspaceHref(contactId: string) {
  return `/calls/workspace?contactId=${encodeURIComponent(contactId)}`;
}

export function QuickAddCaller({
  match = emptyMatch(),
  initialPhone = "",
  initialQuery = "",
  onSubmit,
}: {
  match?: PhoneMatch;
  initialPhone?: string;
  initialQuery?: string;
  onSubmit?: (input: QuickAddCallerSubmission) => Promise<QuickAddSubmission> | QuickAddSubmission;
}) {
  const [, navigate] = useLocation();
  const [error, setError] = useState("");
  const requestKey = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resolvedMatch, setResolvedMatch] = useState(match);
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [canContinueCreating, setCanContinueCreating] = useState(false);
  const [values, setValues] = useState<QuickAddCallerForm>({
    name: "",
    organizationName: "",
    phone: initialPhone,
    email: initialQuery.includes("@") ? initialQuery : "",
    reason: "",
    eventDate: "",
    eventLocation: "",
  });

  function updateValue(name: keyof QuickAddCallerForm, value: string) {
    setCandidates(null);
    setCanContinueCreating(false);
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submitValues(continueCreating: boolean) {
    if (!onSubmit) {
      setError("The caller form is unavailable. Try again.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const result = await onSubmit({
        requestKey: requestKey.current ??= crypto.randomUUID(),
        ...values,
        phone: values.phone.trim(),
        email: values.email.trim(),
        eventDate: values.eventDate.trim(),
        eventLocation: values.eventLocation.trim(),
        continueCreating,
      });
      if (!result.ok) {
        if ("candidates" in result) {
          setCandidates(result.candidates);
          setCanContinueCreating(result.canContinueCreating);
          return;
        }
        setError(result.error);
        return;
      }
      navigate(callWorkspaceHref(result.contactId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The caller could not be created. Try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.phone.trim() && !values.email.trim()) {
      setError("Enter a phone number or email address.");
      return;
    }
    void submitValues(false);
  }

  if (resolvedMatch.kind === "one") {
    return (
      <section aria-labelledby="caller-match-title" className="grid gap-4">
        <h2 className="text-xl font-bold" id="caller-match-title">Caller match found</h2>
        <p className="text-slate-600">This phone number belongs to {callerName(resolvedMatch.contact.firstName, resolvedMatch.contact.lastName)}.</p>
        <Link className="button-primary w-fit" href={callWorkspaceHref(resolvedMatch.contact.id)}>
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
              <Link className="block rounded-lg border border-slate-200 p-4 font-semibold hover:bg-slate-50" href={callWorkspaceHref(contact.id)}>
                Open {callerName(contact.firstName, contact.lastName)} in Call Workspace
              </Link>
            </li>
          ))}
        </ul>
        <button className="button-secondary w-fit" onClick={() => setResolvedMatch(emptyMatch())} type="button">Back to caller details</button>
      </section>
    );
  }

  const hasExactConflict = candidates !== null && !canContinueCreating;

  return (
    <form className="grid gap-5" noValidate onSubmit={submit}>
      <div>
        <h2 className="text-xl font-bold">New caller</h2>
        <p className="mt-1 text-slate-600">Capture the essentials to start a call note.</p>
      </div>
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
      {candidates !== null ? (
        <section aria-labelledby="duplicate-title" className="grid gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div>
            <h3 className="font-bold" id="duplicate-title">Possible duplicate</h3>
            <p className="mt-1 text-sm text-amber-950">
              {hasExactConflict
                ? "An exact phone or email conflict must be opened instead of bypassed."
                : "Review these likely matches before creating a separate contact."}
            </p>
          </div>
          <ul className="grid gap-3">
            {candidates.map((candidate) => (
              <li className="grid gap-2 rounded-lg border border-amber-200 bg-white p-3" key={candidate.contactId}>
                <p className="font-semibold">{candidate.name}</p>
                {candidate.organizationName ? <p className="text-sm">{candidate.organizationName}</p> : null}
                {candidate.city || candidate.region ? <p className="text-sm">{[candidate.city, candidate.region].filter(Boolean).join(", ")}</p> : null}
                <p className="text-xs font-semibold text-slate-600">{candidate.reasons.join(" · ")}</p>
                <Link className="button-secondary w-fit" href={`/contacts/${candidate.contactId}`}>Open profile</Link>
              </li>
            ))}
          </ul>
          {!hasExactConflict ? (
            <button className="button-primary w-fit" disabled={isSubmitting} onClick={() => void submitValues(true)} type="button">
              {isSubmitting ? "Creating…" : "Create separate contact"}
            </button>
          ) : null}
        </section>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-1.5 font-medium sm:col-span-2">Name<input autoComplete="name" name="name" onChange={(event) => updateValue("name", event.target.value)} required value={values.name} /></label>
        <label className="grid gap-1.5 font-medium sm:col-span-2">Organization or event<input autoComplete="organization" name="organizationName" onChange={(event) => updateValue("organizationName", event.target.value)} required value={values.organizationName} /></label>
        <label className="grid gap-1.5 font-medium">Phone<input autoComplete="tel" name="phone" onChange={(event) => updateValue("phone", event.target.value)} type="tel" value={values.phone} /></label>
        <label className="grid gap-1.5 font-medium">Email<input autoComplete="email" name="email" onChange={(event) => updateValue("email", event.target.value)} type="email" value={values.email} /></label>
        <label className="grid gap-1.5 font-medium sm:col-span-2">Reason for calling<textarea name="reason" onChange={(event) => updateValue("reason", event.target.value)} required rows={3} value={values.reason} /></label>
        <label className="grid gap-1.5 font-medium">Event date (optional)<input name="eventDate" onChange={(event) => updateValue("eventDate", event.target.value)} type="date" value={values.eventDate} /></label>
        <label className="grid gap-1.5 font-medium">Event location (optional)<input autoComplete="address-level2" name="eventLocation" onChange={(event) => updateValue("eventLocation", event.target.value)} value={values.eventLocation} /></label>
      </div>
      <div><button className="button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Creating…" : "Create caller"}</button></div>
    </form>
  );
}
