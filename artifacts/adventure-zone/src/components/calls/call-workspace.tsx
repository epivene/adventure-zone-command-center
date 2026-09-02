"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  ActivityTimeline,
  type ActivityMutationResult,
  type ActivityRevisionResult,
} from "@/components/activities/activity-timeline";
import { CallBriefingCard } from "@/components/calls/call-briefing-card";
import { CallContextRow } from "@/components/calls/call-context-row";
import { CallScriptCard } from "@/components/calls/call-script-card";
import { GuidedCallScriptCard } from "@/components/calls/guided-call-script-card";
import type { ComputerCallTerminal } from "@/components/calls/computer-call-panel";
import { PhoneActions, type ComputerCallingCapability } from "@/components/calls/phone-actions";
import type {
  ActivityParent,
  ActivityTimelineItem,
  CreateActivityInput,
  EditActivityInput,
} from "@/features/activities/activity-types";
import type { BookingStatus } from "@/features/bookings/booking-types";
import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";
import {
  buildCallDraftKey,
  clearCallDraft,
  loadCallDraft,
  saveCallDraft,
} from "@/features/calls/call-draft";
import {
  getGuidedCallScript,
  type GuidedCallRenderContext,
} from "@/features/calls/guided-call-scripts";
import {
  chooseGuidedResponse,
  createGuidedCallState,
  type GuidedCallState,
} from "@/features/calls/guided-call-state";
import type {
  CallBriefing,
  CallDirection,
  CallDisposition,
  CallMethod,
  CallScriptKind,
  CompleteCallInput,
  GuidedCallScriptKind,
} from "@/features/calls/call-types";
import type { ContactPhoneRecord } from "@/features/contact-phones/contact-phone-types";
import {
  BUSINESS_TIME_ZONE,
  parseBusinessDate,
} from "@/lib/business-date";

const ComputerCallPanel = lazy(async () => ({
  default: (await import("@/components/calls/computer-call-panel")).ComputerCallPanel,
}));

export type CompleteCallResult = { ok: true } | { ok: false; error: string };
export type CallWorkspaceMode = "full" | "compact" | "mobile";

const dispositionOptions: { value: CallDisposition; label: string }[] = [
  { value: "no_answer", label: "No answer" },
  { value: "left_voicemail", label: "Left voicemail" },
  { value: "spoke_with_contact", label: "Spoke with contact" },
  { value: "follow_up_needed", label: "Follow-up needed" },
  { value: "interested", label: "Interested" },
  { value: "proposal_contract_sent", label: "Proposal or contract sent" },
  { value: "booked", label: "Booked" },
  { value: "declined", label: "Declined" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "do_not_call", label: "Do Not Call" },
  { value: "move_to_last_resort", label: "Move to Last Resort" },
];

function formatDate(value: Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(value);
}

function methodForPhone(isMobileLog: boolean, phone: ContactPhoneRecord | null): CallMethod {
  if (isMobileLog) return "mobile_log";
  return phone?.type === "office" ? "office_call" : "standard_call";
}

function scriptForDirection(direction: CallDirection, fallback: CallScriptKind): CallScriptKind {
  if (direction === "incoming") return "incoming_inquiry";
  return fallback === "incoming_inquiry" ? "first_outreach" : fallback;
}

function persistedScriptKind(kind: GuidedCallScriptKind): CallScriptKind {
  if (kind === "incoming_inquiry") return "incoming_inquiry";
  if (kind === "proposal_contract") return "contract_follow_up";
  if (kind === "first_outreach") return "first_outreach";
  return "follow_up";
}

function dateInputForPreset(preset: GuidedCallState["staged"]["followUpPreset"]) {
  if (!preset) return "";
  const date = new Date();
  if (preset === "tomorrow") date.setDate(date.getDate() + 1);
  else if (preset === "next_week") date.setDate(date.getDate() + 7);
  else if (preset === "next_season") date.setFullYear(date.getFullYear() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeSuggestedAction(value: string | null) {
  if (!value) return "";
  const aliases: Record<string, string> = {
    send_info: "send_information",
    send_proposal: "prepare_quote",
    resend_proposal: "prepare_quote",
    research: "send_information",
    future_season: "call",
  };
  return aliases[value] ?? value;
}

function maskedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : "•••";
}

type WorkspaceContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  region: string | null;
};

type WorkspaceBooking = {
  id: string;
  name: string;
  city: string;
  region: string;
  status: BookingStatus;
  startsAt: Date | null;
};

type WorkspaceProps = {
  mode?: CallWorkspaceMode;
  organization: { id: string; name: string; lastResort: boolean; lastResortReason: string | null } | null;
  contact: WorkspaceContact | null;
  booking: WorkspaceBooking | null;
  followUp: { id: string; kind: string; dueAt: Date } | null;
  phones?: ContactPhoneRecord[];
  contextSummary?: {
    bookingStatusLabel: string | null;
    travelLeg: { name: string } | null;
    lastContactedAt: Date | string | null;
  } | null;
  defaultScriptKind?: CallScriptKind;
  scriptPrompts?: string[];
  briefing?: CallBriefing | null;
  recommendedGuidedScriptKind?: GuidedCallScriptKind | null;
  assistedCallingEnabled?: boolean;
  voicemailLauncherUrl?: string | null;
  computerCalling?: ComputerCallingCapability;
  timeline: ActivityTimelineItem[];
  onComplete: (input: CompleteCallInput) => Promise<CompleteCallResult>;
  activityParent?: ActivityParent;
  createActivity?: (input: CreateActivityInput) => Promise<ActivityMutationResult>;
  editActivity?: (input: EditActivityInput) => Promise<ActivityMutationResult>;
  loadRevisions?: (activityId: string, page?: number) => Promise<ActivityRevisionResult>;
  operations?: BookingOperationsSummary | null;
};

export function CallWorkspace({
  mode = "full",
  organization,
  contact,
  booking,
  followUp,
  phones = [],
  contextSummary = null,
  defaultScriptKind = followUp ? "follow_up" : "first_outreach",
  scriptPrompts = [],
  briefing = null,
  recommendedGuidedScriptKind = null,
  assistedCallingEnabled = false,
  voicemailLauncherUrl = null,
  computerCalling,
  timeline,
  onComplete,
  activityParent,
  createActivity,
  editActivity,
  loadRevisions = async () => ({ ok: true, revisions: [] }),
  operations = null,
}: WorkspaceProps) {
  const isMobileLog = mode === "mobile";
  const primaryPhone = phones.find((phone) => phone.primary) ?? phones[0] ?? null;
  const initialGuidedKind: GuidedCallScriptKind =
    recommendedGuidedScriptKind ??
    (isMobileLog ? "incoming_inquiry" : defaultScriptKind === "contract_follow_up" ? "proposal_contract" : defaultScriptKind);
  const [startedAt, setStartedAt] = useState<Date | null>(() => isMobileLog ? new Date() : null);
  const [requestKey, setRequestKey] = useState<string | null>(() => isMobileLog ? crypto.randomUUID() : null);
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(primaryPhone?.id ?? null);
  const [direction, setDirection] = useState<CallDirection>(isMobileLog ? "incoming" : "outgoing");
  const [method, setMethod] = useState<CallMethod>(() => methodForPhone(isMobileLog, primaryPhone));
  const [scriptKind, setScriptKind] = useState<CallScriptKind>(() => scriptForDirection(isMobileLog ? "incoming" : "outgoing", defaultScriptKind));
  const [guidedKind, setGuidedKind] = useState<GuidedCallScriptKind>(initialGuidedKind);
  const [guidedState, setGuidedState] = useState<GuidedCallState>(() => createGuidedCallState(getGuidedCallScript(initialGuidedKind)));
  const [note, setNote] = useState("");
  const [disposition, setDisposition] = useState<CallDisposition>("no_answer");
  const [nextActionKind, setNextActionKind] = useState("");
  const [nextActionDueAt, setNextActionDueAt] = useState("");
  const [lastResortReason, setLastResortReason] = useState("");
  const [lastResortConfirmed, setLastResortConfirmed] = useState(false);
  const [doNotCallReason, setDoNotCallReason] = useState("");
  const [doNotCallConfirmed, setDoNotCallConfirmed] = useState(false);
  const [doNotCallPhoneId, setDoNotCallPhoneId] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [activeDraftKey, setActiveDraftKey] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [locallySuppressedPhoneIds, setLocallySuppressedPhoneIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [computerPanelOpen, setComputerPanelOpen] = useState(false);
  const [computerCall, setComputerCall] = useState<ComputerCallTerminal | null>(null);
  const [computerCallActive, setComputerCallActive] = useState(false);
  const awaitingComputerReconciliation = computerPanelOpen && !computerCall;

  const draftKey = useMemo(() => buildCallDraftKey({
    organizationId: organization?.id ?? null,
    contactId: contact?.id ?? null,
    bookingId: booking?.id ?? null,
    followUpId: followUp?.id ?? null,
  }), [organization?.id, contact?.id, booking?.id, followUp?.id]);

  const selectedPhoneRecord =
    phones.find((phone) => phone.id === selectedPhoneId) ?? primaryPhone;
  const selectedPhone = selectedPhoneRecord && locallySuppressedPhoneIds.has(selectedPhoneRecord.id)
    ? {
        ...selectedPhoneRecord,
        doNotCallAt: new Date().toISOString(),
        doNotCallReason: "Marked Do Not Call during this call.",
      }
    : selectedPhoneRecord;

  const guidedRenderContext: GuidedCallRenderContext = {
    contactName: contact?.name ?? null,
    eventName: briefing?.eventName ?? booking?.name ?? organization?.name ?? null,
    eventDate: briefing?.eventDate ?? null,
    location: briefing?.location ?? (booking ? [booking.city, booking.region].filter(Boolean).join(", ") : null),
    packageInterest: briefing?.packageInterest ?? operations?.packageNames?.join(", ") ?? null,
  };

  useEffect(() => {
    const nextGuidedKind: GuidedCallScriptKind =
      recommendedGuidedScriptKind ??
      (isMobileLog ? "incoming_inquiry" : defaultScriptKind === "contract_follow_up" ? "proposal_contract" : defaultScriptKind);
    setDraftReady(false);
    setActiveDraftKey(null);
    setStartedAt(isMobileLog ? new Date() : null);
    setRequestKey(isMobileLog ? crypto.randomUUID() : null);
    setSelectedPhoneId(primaryPhone?.id ?? null);
    setDirection(isMobileLog ? "incoming" : "outgoing");
    setMethod(methodForPhone(isMobileLog, primaryPhone));
    setScriptKind(scriptForDirection(isMobileLog ? "incoming" : "outgoing", defaultScriptKind));
    setGuidedKind(nextGuidedKind);
    setGuidedState(createGuidedCallState(getGuidedCallScript(nextGuidedKind)));
    setNote("");
    setDisposition("no_answer");
    setNextActionKind("");
    setNextActionDueAt("");
    setLastResortConfirmed(false);
    setLastResortReason("");
    setDoNotCallConfirmed(false);
    setDoNotCallReason("");
    setDoNotCallPhoneId(null);
    setDraftRestored(false);
    setLocallySuppressedPhoneIds(new Set());
    setError("");
    setIsSubmitting(false);
    setIsSaved(false);
    setComputerPanelOpen(false);
    setComputerCall(null);
    setComputerCallActive(false);

    const draft = loadCallDraft(draftKey);
    if (draft) {
      setStartedAt(new Date());
      setRequestKey(draft.requestKey);
      const restoredPhoneId = phones.some((phone) => phone.id === draft.selectedPhoneId)
        ? draft.selectedPhoneId
        : primaryPhone?.id ?? null;
      setSelectedPhoneId(restoredPhoneId);
      setDirection(draft.direction);
      setMethod(isMobileLog ? "mobile_log" : draft.method);
      setScriptKind(draft.scriptKind);
      setNote(draft.note);
      setDisposition(draft.disposition);
      setNextActionKind(draft.nextActionKind);
      setNextActionDueAt(draft.nextActionDate);
      setLastResortConfirmed(draft.lastResortConfirmed);
      setLastResortReason(draft.lastResortReason);
      const dncBoundToRestoredPhone = draft.doNotCallPhoneId !== null && draft.doNotCallPhoneId === restoredPhoneId;
      setDoNotCallConfirmed(dncBoundToRestoredPhone && draft.doNotCallConfirmed);
      setDoNotCallReason(dncBoundToRestoredPhone ? draft.doNotCallReason : "");
      setDoNotCallPhoneId(dncBoundToRestoredPhone ? draft.doNotCallPhoneId : null);
      setDraftRestored(true);
    }
    setActiveDraftKey(draftKey);
    setDraftReady(true);
  }, [draftKey, isMobileLog, defaultScriptKind, recommendedGuidedScriptKind]);

  useEffect(() => {
    if (!draftReady || activeDraftKey !== draftKey || !startedAt || !requestKey || isSaved) return;
    const timer = window.setTimeout(() => {
      saveCallDraft(draftKey, {
        version: 1,
        savedAt: "",
        requestKey,
        selectedPhoneId,
        direction,
        method,
        scriptKind,
        note,
        disposition,
        nextActionKind,
        nextActionDate: nextActionDueAt,
        lastResortConfirmed,
        lastResortReason,
        doNotCallConfirmed,
        doNotCallReason,
        doNotCallPhoneId,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    draftReady, activeDraftKey, startedAt, requestKey, isSaved, draftKey, selectedPhoneId,
    direction, method, scriptKind, note, disposition, nextActionKind,
    nextActionDueAt, lastResortConfirmed, lastResortReason,
    doNotCallConfirmed, doNotCallReason, doNotCallPhoneId,
  ]);

  function discardDraft() {
    clearCallDraft(draftKey);
    setStartedAt(isMobileLog ? new Date() : null);
    setRequestKey(isMobileLog ? crypto.randomUUID() : null);
    if (isMobileLog) {
      setSelectedPhoneId(primaryPhone?.id ?? null);
      setDirection("incoming");
      setMethod("mobile_log");
      setScriptKind(scriptForDirection("incoming", defaultScriptKind));
    }
    const script = getGuidedCallScript(initialGuidedKind);
    setGuidedKind(initialGuidedKind);
    setGuidedState(createGuidedCallState(script));
    setNote("");
    setDisposition("no_answer");
    setNextActionKind("");
    setNextActionDueAt("");
    setLastResortReason("");
    setLastResortConfirmed(false);
    setDoNotCallReason("");
    setDoNotCallConfirmed(false);
    setDoNotCallPhoneId(null);
    setDraftRestored(false);
    setError("");
    setComputerCall(null);
    setComputerCallActive(false);
    setComputerPanelOpen(false);
    if (!isMobileLog) {
      setMethod(methodForPhone(false, selectedPhone));
    }
  }

  function chooseDisposition(value: CallDisposition) {
    setDisposition(value);
    if (value !== "move_to_last_resort") {
      setLastResortConfirmed(false);
      setLastResortReason("");
    }
    if (value !== "do_not_call") {
      setDoNotCallConfirmed(false);
      setDoNotCallReason("");
      setDoNotCallPhoneId(null);
    }
  }

  function changeGuidedKind(kind: GuidedCallScriptKind) {
    setGuidedKind(kind);
    setGuidedState(createGuidedCallState(getGuidedCallScript(kind)));
    setScriptKind(persistedScriptKind(kind));
  }

  const startComputerCall = useCallback(() => {
    setComputerPanelOpen(true);
    setError("");
  }, []);

  const completeComputerCall = useCallback((call: ComputerCallTerminal) => {
    setComputerCall(call);
    setStartedAt(new Date(call.startedAt));
    setRequestKey(call.sessionId);
    setMethod("browser_voip");
    setDirection("outgoing");
  }, []);

  const resetComputerCall = useCallback(() => {
    setComputerCall(null);
    setComputerCallActive(false);
    if (!isMobileLog) {
      setStartedAt(null);
      setRequestKey(null);
      setMethod(methodForPhone(false, selectedPhone));
    }
  }, [isMobileLog, selectedPhone]);

  function chooseGuided(responseId: string) {
    const script = getGuidedCallScript(guidedKind);
    const next = chooseGuidedResponse(script, guidedState, responseId);
    setGuidedState(next);
    if (next.staged.disposition) chooseDisposition(next.staged.disposition);
    if (next.staged.nextAction) setNextActionKind(normalizeSuggestedAction(next.staged.nextAction));
    if (next.staged.followUpPreset) setNextActionDueAt(dateInputForPreset(next.staged.followUpPreset));
    if (next.staged.noteFragments.length) {
      setNote((current) => {
        const additions = next.staged.noteFragments.filter((fragment) => !current.includes(fragment));
        return additions.length ? [current.trim(), ...additions].filter(Boolean).join("\n") : current;
      });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!startedAt || !requestKey) {
      setError("Start the call note before saving.");
      return;
    }
    const dueAt = nextActionDueAt ? parseBusinessDate(nextActionDueAt) : null;
    if (nextActionDueAt && !dueAt) {
      setError("Choose a valid next-action date.");
      return;
    }
    if ((nextActionKind && !dueAt) || (!nextActionKind && dueAt)) {
      setError("Choose both a next action and date, or leave both blank.");
      return;
    }
    if (disposition === "move_to_last_resort" && (!lastResortReason.trim() || !lastResortConfirmed)) {
      setError("Add a reason and confirm moving this organization to Last Resort.");
      return;
    }
    if (disposition === "do_not_call" && (!selectedPhone || !doNotCallReason.trim() || !doNotCallConfirmed || doNotCallPhoneId !== selectedPhone.id)) {
      setError("Select a phone, add a reason, and confirm Do Not Call.");
      return;
    }

    setError("");
    setIsSubmitting(true);
    try {
      const result = await onComplete({
        requestKey,
        organizationId: organization?.id ?? null,
        contactId: contact?.id ?? null,
        bookingId: booking?.id ?? null,
        followUpId: followUp?.id ?? null,
        note,
        disposition,
        resultingBookingStatus: null,
        startedAt,
        endedAt: computerCall ? new Date(computerCall.endedAt) : new Date(),
        nextAction: nextActionKind && dueAt ? { kind: nextActionKind, dueAt } : null,
        lastResortReason:
          disposition === "move_to_last_resort"
            ? lastResortReason.trim() || null
            : null,
        lastResortConfirmed:
          disposition === "move_to_last_resort" && lastResortConfirmed,
        approvedContactUpdates: null,
        approvedBookingUpdates: null,
        direction,
        method,
        phoneId: computerCall?.phoneId ?? selectedPhone?.id ?? null,
        scriptKind,
        doNotCallConfirmed:
          disposition === "do_not_call" && doNotCallConfirmed,
        doNotCallReason:
          disposition === "do_not_call"
            ? doNotCallReason.trim() || null
            : null,
        doNotCallPhoneId:
          disposition === "do_not_call" && doNotCallConfirmed
            ? doNotCallPhoneId
            : null,
        entryMode: isMobileLog ? "mobile" : "desktop",
      });
      if (!result.ok) setError(result.error);
      else {
        clearCallDraft(draftKey);
        if (disposition === "do_not_call" && selectedPhone) {
          setLocallySuppressedPhoneIds((ids) => new Set(ids).add(selectedPhone.id));
        }
        setIsSaved(true);
      }
    } catch {
      setError("Could not save this call note. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const twoColumn = mode === "full"
    ? "lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,1fr)]"
    : "";

  return (
    <div
      className="mx-auto grid max-w-7xl gap-5"
      data-mode={mode}
      data-testid="call-workspace"
    >
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Calls</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{isMobileLog ? "Log call" : "Call Workspace"}</h1>
        <p className="mt-2 text-slate-600">
          {isMobileLog ? "Add a call note and its next concrete action." : "Record this call and its next concrete action."}
        </p>
      </header>

      <CallContextRow
        booking={booking}
        bookingStatusLabel={contextSummary?.bookingStatusLabel}
        contact={contact}
        followUp={followUp}
        lastContactedAt={contextSummary?.lastContactedAt}
        organization={organization}
        travelLeg={contextSummary?.travelLeg}
      />

      {briefing ? <CallBriefingCard briefing={briefing} /> : null}

      {organization?.lastResort ? (
        <aside className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-950" role="alert">
          <strong>{organization.name} is marked Last Resort.</strong>{" "}
          {organization.lastResortReason || "Review this account before making any new commitments."}
        </aside>
      ) : null}

      {briefing ? (
        <GuidedCallScriptCard
          kind={guidedKind}
          lastOutcome={briefing.lastOutcome}
          onChangeKind={changeGuidedKind}
          onChooseResponse={chooseGuided}
          renderContext={guidedRenderContext}
          state={guidedState}
        />
      ) : null}

      <div className={`grid gap-5 ${twoColumn} lg:items-start`}>
        <div className="grid gap-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="phone-actions-title">
            <h2 className="text-xl font-bold" id="phone-actions-title">Phone</h2>
            {phones.length ? (
              <div className="mt-3 grid gap-3">
                <label className="grid gap-1.5 font-medium">
                  Phone number
                  <select
                    disabled={computerCallActive}
                    onChange={(event) => {
                      const nextPhoneId = event.target.value;
                      const nextPhone = phones.find((phone) => phone.id === nextPhoneId) ?? null;
                      setSelectedPhoneId(nextPhoneId);
                      setDoNotCallConfirmed(false);
                      setDoNotCallReason("");
                      setDoNotCallPhoneId(null);
                      setMethod(methodForPhone(isMobileLog, nextPhone));
                    }}
                    value={selectedPhone?.id ?? ""}
                  >
                    {phones.map((phone) => (
                      <option key={phone.id} value={phone.id}>
                        {phone.label ?? phone.type} · {maskedPhone(phone.number)}{phone.extension ? ` ext. ${phone.extension}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedPhone ? (
                  <PhoneActions
                    assistedCallingEnabled={assistedCallingEnabled}
                    computerCalling={computerCalling}
                    onSelectMethod={isMobileLog || computerCall ? undefined : setMethod}
                    onStartComputerCall={computerCalling?.enabled && organization && contact ? startComputerCall : undefined}
                    phone={selectedPhone}
                    voicemailLauncherUrl={voicemailLauncherUrl}
                  />
                ) : null}
                {computerPanelOpen && selectedPhone && organization && contact && computerCalling?.enabled && computerCalling.callerIdDisplay ? (
                  <Suspense fallback={<p className="text-sm text-slate-600" role="status">Loading computer call controls…</p>}>
                    <ComputerCallPanel
                      callerIdDisplay={computerCalling.callerIdDisplay}
                      contact={contact}
                      onPhaseChange={setComputerCallActive}
                      onReset={resetComputerCall}
                      onTerminal={completeComputerCall}
                      organizationId={organization.id}
                      phone={selectedPhone}
                    />
                  </Suspense>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-600">
                No phone is linked to this contact.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="call-details-title">
            <h2 className="text-xl font-bold" id="call-details-title">{isMobileLog ? "Call details" : "Record call"}</h2>
            {awaitingComputerReconciliation ? (
              <p className="mt-4 text-sm text-slate-600" role="status">
                Waiting for authoritative call details before recording the outcome.
              </p>
            ) : isSaved ? (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="font-semibold text-emerald-950" role="status">Call note saved.</p>
                <p className="mt-1 text-sm text-emerald-900">
                  {isMobileLog ? "This call log is complete and cannot be submitted again." : "This call is complete and cannot be submitted again from this workspace."}
                </p>
                <a className="link mt-3 inline-block" href="/today">Return to Today</a>
              </div>
            ) : !startedAt ? (
              <div className="mt-4">
                <p className="text-sm text-slate-600">Timing starts only when you are ready to record the note.</p>
                <button
                  className="button-primary mt-3"
                  onClick={() => {
                    setStartedAt(new Date());
                    setRequestKey(crypto.randomUUID());
                  }}
                  type="button"
                >
                  Start call note
                </button>
              </div>
            ) : (
              <form className="mt-4 grid gap-4" onSubmit={submit}>
                {draftRestored ? (
                  <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900" role="status">
                    Draft restored.
                  </p>
                ) : null}
                {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
                {isMobileLog ? (
                  <label className="grid gap-1.5 font-medium" htmlFor="call-direction">
                    Direction
                    <select
                      id="call-direction"
                      onChange={(event) => {
                        const nextDirection = event.target.value as CallDirection;
                        setDirection(nextDirection);
                        setScriptKind(scriptForDirection(nextDirection, defaultScriptKind));
                        changeGuidedKind(nextDirection === "incoming" ? "incoming_inquiry" : initialGuidedKind);
                      }}
                      value={direction}
                    >
                      <option value="incoming">Incoming</option>
                      <option value="outgoing">Outgoing</option>
                    </select>
                  </label>
                ) : null}
                <label className="grid gap-1.5 font-medium" htmlFor="call-note">
                  Call note (optional)
                  <textarea aria-label="Call note" className="min-h-32" id="call-note" onChange={(event) => setNote(event.target.value)} value={note} />
                </label>
                <fieldset className="grid gap-2 rounded-lg border border-slate-200 p-3">
                  <legend className="px-1 font-semibold">Quick outcome</legend>
                  <div className="flex flex-wrap gap-2">
                    {(["no_answer", "left_voicemail", "spoke_with_contact", "follow_up_needed"] as CallDisposition[]).map((value) => (
                      <button
                        className="button-secondary"
                        key={value}
                        onClick={() => chooseDisposition(value)}
                        type="button"
                      >
                        {dispositionOptions.find((option) => option.value === value)!.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="grid gap-1.5 font-medium" htmlFor="call-disposition">
                  Call disposition
                  <select
                    id="call-disposition"
                    onChange={(event) => {
                      chooseDisposition(event.target.value as CallDisposition);
                    }}
                    value={disposition}
                  >
                    {dispositionOptions
                      .filter((option) => organization || option.value !== "move_to_last_resort")
                      .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4">
                  <legend className="px-1 font-semibold">Next action</legend>
                  <label className="grid gap-1.5 font-medium" htmlFor="next-action">
                    Next action
                    <select id="next-action" onChange={(event) => setNextActionKind(event.target.value)} value={nextActionKind}>
                      <option value="">No next action</option>
                      <option value="call">Call</option>
                      <option value="send_information">Send information</option>
                      <option value="prepare_quote">Prepare quote</option>
                      <option value="check_contract">Check on contract</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 font-medium" htmlFor="next-action-date">
                    Next action date
                    <input id="next-action-date" onChange={(event) => setNextActionDueAt(event.target.value)} type="date" value={nextActionDueAt} />
                  </label>
                </fieldset>
                {disposition === "do_not_call" ? (
                  <fieldset className="grid gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
                    <legend className="px-1 font-semibold text-rose-950">Do Not Call</legend>
                    <label className="grid gap-1.5 font-medium" htmlFor="do-not-call-reason">
                      Do Not Call reason
                      <textarea id="do-not-call-reason" onChange={(event) => setDoNotCallReason(event.target.value)} value={doNotCallReason} />
                    </label>
                    <label className="flex items-start gap-2 font-medium">
                      <input
                        checked={doNotCallConfirmed}
                        className="mt-1"
                        onChange={(event) => {
                          setDoNotCallConfirmed(event.target.checked);
                          setDoNotCallPhoneId(event.target.checked ? selectedPhone?.id ?? null : null);
                        }}
                        type="checkbox"
                      />
                      <span>I confirm this selected number should be marked Do Not Call</span>
                    </label>
                  </fieldset>
                ) : null}
                {disposition === "move_to_last_resort" ? (
                  <fieldset className="grid gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
                    <legend className="px-1 font-semibold text-rose-950">Move organization to Last Resort</legend>
                    <label className="grid gap-1.5 font-medium" htmlFor="last-resort-reason">
                      Last Resort reason
                      <textarea id="last-resort-reason" maxLength={2_000} onChange={(event) => setLastResortReason(event.target.value)} value={lastResortReason} />
                    </label>
                    <label className="flex items-start gap-2 font-medium">
                      <input checked={lastResortConfirmed} className="mt-1" onChange={(event) => setLastResortConfirmed(event.target.checked)} type="checkbox" />
                      <span>I confirm this organization should be moved to Last Resort</span>
                    </label>
                  </fieldset>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <button className="button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Saving…" : "Save call note"}</button>
                  <button className="button-secondary" onClick={discardDraft} type="button">Discard draft</button>
                </div>
              </form>
            )}
          </section>

          {!isMobileLog ? <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" open={mode !== "compact"}>
            <summary className="cursor-pointer text-xl font-bold">Recent history</summary>
            <div className="mt-4">
              <ActivityTimeline
                activities={timeline}
                createActivity={createActivity}
                editActivity={editActivity}
                loadRevisions={loadRevisions}
                parent={activityParent}
              />
            </div>
          </details> : null}
        </div>

        {!isMobileLog ? <aside className="grid gap-5">
          {!briefing ? (
            <CallScriptCard
              initialKind={defaultScriptKind}
              initialPrompts={scriptPrompts}
              kind={scriptKind}
              onChange={setScriptKind}
            />
          ) : null}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="caller-title">
            <h2 className="text-xl font-bold" id="caller-title">Caller</h2>
            {contact ? (
              <div className="mt-3 grid gap-1 text-sm">
                <p className="font-semibold text-base">{contact.name}</p>
                <p>{contact.phone ? maskedPhone(contact.phone) : "No phone recorded"}</p>
                <p className="break-all">{contact.email || "No email recorded"}</p>
                {contact.city || contact.region ? <p>{[contact.city, contact.region].filter(Boolean).join(", ")}</p> : null}
              </div>
            ) : <p className="mt-3 text-sm text-slate-600">No contact is linked to this call.</p>}
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="booking-snapshot-title">
            <h2 className="text-xl font-bold" id="booking-snapshot-title">Booking snapshot</h2>
            {booking ? (
              <div className="mt-3 grid gap-1 text-sm">
                <p className="font-semibold text-base">{booking.name}</p>
                <p>{booking.city}, {booking.region}</p>
                <p>{contextSummary?.bookingStatusLabel ?? booking.status.replaceAll("_", " ")}</p>
                <p>{formatDate(booking.startsAt)}</p>
                {operations ? (
                  <div className="mt-2 grid gap-1 border-t border-slate-200 pt-2">
                    <p className="font-semibold">{operations.packageNames.join(" + ") || "No packages"}</p>
                    <p>
                      {operations.packageNames.length} {operations.packageNames.length === 1 ? "package" : "packages"} ·{" "}
                      {operations.sharedAttractionTotal ?? "No"} attractions
                    </p>
                    {operations.pendingRequestCount > 0 ? <p className="font-semibold text-amber-800">{operations.pendingRequestCount} pending special {operations.pendingRequestCount === 1 ? "request" : "requests"}</p> : null}
                    {operations.leg ? <p>Travel leg: {operations.leg.name}</p> : null}
                    {operations.warnings.map((warning) => (
                      <a
                        className={warning.severity === "blocking" ? "font-semibold text-rose-700" : "font-semibold text-amber-800"}
                        href={warning.href}
                        key={warning.id}
                      >
                        {warning.message}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : <p className="mt-3 text-sm text-slate-600">No booking is linked to this call.</p>}
          </section>
        </aside> : null}
      </div>
    </div>
  );
}
