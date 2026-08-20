import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, SkipForward } from "lucide-react";

import { PaperNoteContactEditor } from "./paper-note-contact-editor";
import { PaperNoteDestinationPicker } from "./paper-note-destination-picker";
import { PaperNoteEventDateReview } from "./paper-note-event-date-review";
import { PaperNoteOrganizationPhonesEditor } from "./paper-note-organization-phones-editor";
import { PaperNoteSourceViewer } from "./paper-note-source-viewer";
import type {
  PaperNoteMatch,
  PaperNoteReviewDraft,
  PaperNoteReviewEntryDetails,
} from "@/features/paper-notes/paper-note-review-types";

export function PaperNoteEntryCard({
  entry,
  matches,
  loadSource,
  onSave,
  onApprove,
  onUnapprove,
  onSkip,
}: {
  entry: PaperNoteReviewEntryDetails;
  matches: PaperNoteMatch[];
  loadSource(): Promise<{ url: string; kind: "original" | "analysis" }>;
  onSave(review: PaperNoteReviewDraft, expectedVersion: number): Promise<PaperNoteReviewEntryDetails>;
  onApprove(expectedVersion: number): Promise<PaperNoteReviewEntryDetails>;
  onUnapprove(expectedVersion: number): Promise<PaperNoteReviewEntryDetails>;
  onSkip(expectedVersion: number): Promise<PaperNoteReviewEntryDetails>;
}) {
  const [review, setReview] = useState(entry.review);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [actionBusy, setActionBusy] = useState(false);
  const [manualMatches, setManualMatches] = useState<PaperNoteMatch[]>([]);
  const baseline = useRef(JSON.stringify(entry.review));
  const version = useRef(entry.reviewVersion);

  useEffect(() => {
    setReview(entry.review);
    baseline.current = JSON.stringify(entry.review);
    version.current = entry.reviewVersion;
    setSaveState("saved");
  }, [entry.id, entry.review, entry.reviewVersion]);

  useEffect(() => {
    setManualMatches([]);
  }, [entry.id]);

  useEffect(() => {
    const serialized = JSON.stringify(review);
    if (serialized === baseline.current) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void onSave(review, version.current)
        .then((saved) => {
          baseline.current = JSON.stringify(saved.review);
          version.current = saved.reviewVersion;
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [onSave, review]);

  function updateEvent<K extends keyof PaperNoteReviewDraft["event"]>(
    key: K,
    value: PaperNoteReviewDraft["event"][K],
  ) {
    setReview((current) => ({ ...current, event: { ...current.event, [key]: value } }));
  }

  function updateEventPatch(patch: Partial<PaperNoteReviewDraft["event"]>) {
    setReview((current) => ({ ...current, event: { ...current.event, ...patch } }));
  }

  function updateActivity<K extends keyof PaperNoteReviewDraft["activity"]>(
    key: K,
    value: PaperNoteReviewDraft["activity"][K],
  ) {
    setReview((current) => ({ ...current, activity: { ...current.activity, [key]: value } }));
  }

  function updateContact(index: number, patch: Partial<PaperNoteReviewDraft["contacts"][number]>) {
    setReview((current) => ({
      ...current,
      contacts: current.contacts.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, ...patch } : contact),
    }));
  }

  function updateContactPhone(
    contactIndex: number,
    phoneIndex: number,
    patch: Partial<PaperNoteReviewDraft["contacts"][number]["phones"][number]>,
  ) {
    setReview((current) => ({
      ...current,
      contacts: current.contacts.map((contact, index) => index === contactIndex
        ? {
            ...contact,
            phones: contact.phones.map((phone, index2) => index2 === phoneIndex
              ? { ...phone, ...patch }
              : phone),
          }
        : contact),
    }));
  }

  function updateOrganizationPhone(
    phoneIndex: number,
    patch: Partial<PaperNoteReviewDraft["organizationPhones"][number]>,
  ) {
    setReview((current) => ({
      ...current,
      organizationPhones: current.organizationPhones.map((phone, index) =>
        index === phoneIndex ? { ...phone, ...patch } : phone),
    }));
  }

  function updateConflict(path: string, value: unknown | null) {
    setReview((current) => {
      const conflicts = { ...current.conflicts };
      if (value === null) delete conflicts[path];
      else conflicts[path] = value;
      return { ...current, conflicts };
    });
  }

  function resetExistingContactChoices(current: PaperNoteReviewDraft) {
    return current.contacts.map((contact) => contact.mode === "existing_contact"
      ? { ...contact, mode: "new_contact" as const, selectedContactId: null }
      : contact);
  }

  function rememberMatch(match: PaperNoteMatch) {
    setManualMatches((current) => current.some((candidate) =>
      candidate.organizationId === match.organizationId
      && candidate.organizationLocationId === match.organizationLocationId)
      ? current
      : [...current, match]);
  }

  function chooseExistingMatch(match: PaperNoteMatch) {
    setReview((current) => ({
      ...current,
      destination: {
        mode: "existing_profile",
        organizationId: match.organizationId,
        organizationLocationId: match.organizationLocationId,
      },
      contacts: resetExistingContactChoices(current),
      conflicts: {},
    }));
  }

  function chooseNewLocation(match: PaperNoteMatch) {
    setReview((current) => ({
      ...current,
      destination: {
        mode: "existing_profile_new_location",
        organizationId: match.organizationId,
        newLocation: {
          label: current.event.city.trim() || current.event.venue.trim() || "New location",
          venueName: current.event.venue.trim() || null,
          address1: null,
          address2: null,
          city: current.event.city.trim() || null,
          region: current.event.region.trim().toUpperCase() || null,
          postalCode: null,
        },
      },
      contacts: resetExistingContactChoices(current),
      conflicts: {},
    }));
  }

  function chooseNewProfile() {
    setReview((current) => ({
      ...current,
      destination: { mode: "new_profile", eventFamilyId: null },
      contacts: resetExistingContactChoices(current),
      conflicts: {},
    }));
  }

  function updateNewLocation(
    patch: Partial<Extract<NonNullable<PaperNoteReviewDraft["destination"]>, { mode: "existing_profile_new_location" }>["newLocation"]>,
  ) {
    setReview((current) => {
      if (current.destination?.mode !== "existing_profile_new_location") return current;
      return {
        ...current,
        destination: {
          ...current.destination,
          newLocation: { ...current.destination.newLocation, ...patch },
        },
      };
    });
  }

  async function stateAction(work: (expectedVersion: number) => Promise<PaperNoteReviewEntryDetails>) {
    if (actionBusy || saveState === "saving") return;
    setActionBusy(true);
    try {
      const updated = await work(version.current);
      version.current = updated.reviewVersion;
      baseline.current = JSON.stringify(updated.review);
    } finally {
      setActionBusy(false);
    }
  }

  const blocking = entry.validationIssues.filter((issue) => issue.severity === "blocking");
  const canApprove = entry.state === "ready" && saveState === "saved" && !blocking.length;
  const allMatches = [
    ...matches,
    ...manualMatches.filter((manual) => !matches.some((suggested) =>
      suggested.organizationId === manual.organizationId
      && suggested.organizationLocationId === manual.organizationLocationId)),
  ];
  const selectedOrganizationId = review.destination && "organizationId" in review.destination
    ? review.destination.organizationId
    : null;
  const selectedMatch = selectedOrganizationId
    ? allMatches.find((match) => match.organizationId === selectedOrganizationId) ?? null
    : null;
  const existingDestination = review.destination?.mode === "existing_profile"
    || review.destination?.mode === "existing_profile_new_location";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Paper entry</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">{review.event.name || "Unnamed paper entry"}</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {entry.state.replaceAll("_", " ")} · {saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed — edit again to retry" : "Saved"}
          </p>
        </div>
        <PaperNoteSourceViewer label={review.event.name || "Paper entry"} loadSource={loadSource} />
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Original transcription</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
          {entry.extraction.transcription || "No transcription was available. Check the source paper."}
        </p>
      </div>

      {entry.validationIssues.length ? (
        <div className="mt-4 grid gap-2">
          {entry.validationIssues.map((issue, index) => (
            <p
              className={issue.severity === "blocking" ? "rounded-lg bg-rose-50 p-2 text-sm text-rose-800" : "rounded-lg bg-amber-50 p-2 text-sm text-amber-900"}
              key={`${issue.fieldPath}:${index}`}
            >
              <CircleAlert className="mr-1 inline h-4 w-4" /> {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <section className="mt-5 grid gap-3">
        <h3 className="font-bold text-slate-900">Event</h3>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Event / profile name
          <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={review.event.name} onChange={(event) => updateEvent("name", event.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            City
            <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={review.event.city} onChange={(event) => updateEvent("city", event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            State
            <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal uppercase" maxLength={2} value={review.event.region} onChange={(event) => updateEvent("region", event.target.value.toUpperCase())} />
          </label>
        </div>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Venue
          <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={review.event.venue} onChange={(event) => updateEvent("venue", event.target.value)} />
        </label>
        <PaperNoteEventDateReview event={review.event} onChange={updateEventPatch} />
      </section>

      <section className="mt-6 grid gap-3 border-t border-slate-200 pt-5">
        <h3 className="font-bold text-slate-900">Historical activity</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Date
            <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" type="date" value={review.activity.occurredOn ?? ""} onChange={(event) => updateActivity("occurredOn", event.target.value || null)} />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Method
            <select className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" value={review.activity.method} onChange={(event) => updateActivity("method", event.target.value as PaperNoteReviewDraft["activity"]["method"])}>
              <option value="call">Call</option><option value="email">Email</option><option value="mail">Mail</option><option value="text">Text</option><option value="unknown">Unknown</option>
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Outcome
          <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={review.activity.outcome} onChange={(event) => updateActivity("outcome", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Historical note
          <textarea className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={review.activity.summary} onChange={(event) => updateActivity("summary", event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">
          Old reminder from paper
          <input aria-label="Old reminder from paper" className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={review.oldReminder} onChange={(event) => setReview((current) => ({ ...current, oldReminder: event.target.value }))} />
          <span className="font-normal text-slate-500">Historical only. This does not create a current task.</span>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
          <input aria-label="Starred on original paper" type="checkbox" checked={review.starredOnPaper} onChange={(event) => setReview((current) => ({ ...current, starredOnPaper: event.target.checked }))} />
          Starred on original paper
        </label>
      </section>

      {review.contacts.map((contact, contactIndex) => (
        <PaperNoteContactEditor
          key={contact.key}
          contact={contact}
          contactIndex={contactIndex}
          savedContacts={selectedMatch?.contacts ?? []}
          conflicts={review.conflicts}
          onContactChange={(patch) => updateContact(contactIndex, patch)}
          onPhoneChange={(phoneIndex, patch) => updateContactPhone(contactIndex, phoneIndex, patch)}
          onConflictChange={updateConflict}
        />
      ))}

      <PaperNoteOrganizationPhonesEditor
        phones={review.organizationPhones}
        savedPhones={selectedMatch?.organizationPhones ?? []}
        conflicts={review.conflicts}
        requireDecision={Boolean(existingDestination)}
        onPhoneChange={updateOrganizationPhone}
        onConflictChange={updateConflict}
      />

      <PaperNoteDestinationPicker
        review={review}
        matches={allMatches}
        onChooseExisting={chooseExistingMatch}
        onChooseNewLocation={chooseNewLocation}
        onChooseNewProfile={chooseNewProfile}
        onNewLocationChange={updateNewLocation}
        onRememberMatch={rememberMatch}
      />

      <div className="mt-3">
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700"
          disabled={actionBusy}
          onClick={() => void stateAction(onSkip)}
          type="button"
        >
          <SkipForward className="h-4 w-4" /> Skip this entry
        </button>
      </div>

      {review.destination ? (
        <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm font-semibold text-emerald-900">
          Destination: {review.destination.mode === "new_profile"
            ? "Create new profile"
            : review.destination.mode === "existing_profile"
              ? `Existing profile${selectedMatch ? ` · ${selectedMatch.name}` : ""}`
              : review.destination.mode === "existing_profile_new_location"
                ? `New location under${selectedMatch ? ` ${selectedMatch.name}` : " existing profile"}`
                : review.destination.mode.replaceAll("_", " ")}
        </p>
      ) : null}

      <section className="mt-6 border-t border-slate-200 pt-5">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={review.currentFollowUp.enabled} onChange={(event) => setReview((current) => ({ ...current, currentFollowUp: { ...current.currentFollowUp, enabled: event.target.checked, dueOn: event.target.checked ? current.currentFollowUp.dueOn : null } }))} />
          Create a current follow-up
        </label>
        {review.currentFollowUp.enabled ? (
          <label className="mt-2 grid gap-1 text-sm font-semibold text-slate-700">
            New current follow-up date
            <input className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-normal" type="date" value={review.currentFollowUp.dueOn ?? ""} onChange={(event) => setReview((current) => ({ ...current, currentFollowUp: { ...current.currentFollowUp, dueOn: event.target.value || null } }))} />
          </label>
        ) : null}
      </section>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-200 pt-5">
        {entry.state === "approved" ? (
          <button className="min-h-12 rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-800 disabled:opacity-50" disabled={actionBusy || saveState === "saving"} onClick={() => void stateAction(onUnapprove)} type="button">Unapprove</button>
        ) : (
          <button className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-orange-600 px-4 py-3 font-bold text-white disabled:opacity-50" disabled={!canApprove || actionBusy} onClick={() => void stateAction(onApprove)} type="button"><Check className="h-4 w-4" /> Approve entry</button>
        )}
      </div>
    </article>
  );
}
