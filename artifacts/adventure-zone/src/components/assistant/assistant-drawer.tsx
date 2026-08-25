import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bot, WifiOff, X } from "lucide-react";
import { useLocation } from "wouter";

import {
  askBookingAssistant,
  askGeneralAssistant,
  getLatestAssistantConversation,
  loadAssistantSnapshot,
} from "@/features/assistant/assistant-api";
import {
  continueLeadScout,
  deepenLeadScoutCandidate,
  dismissLeadScoutCandidate,
  getLatestLeadScoutRun,
  getLeadScoutRun,
  saveLeadScoutCandidate,
  startLeadScout,
  stopLeadScout,
  type LeadScoutSaveResult,
  type LeadScoutSaveSubmission,
  type RadiusScoutRequest,
} from "@/features/assistant/lead-scout-api";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import type {
  ActiveAssistantContext,
  AssistantAnswer,
  AssistantContextBundle,
  AssistantLeadMatch,
  AssistantProfileSearchResult,
  BookingBrief,
  GeneralAssistantResponse,
  LeadScoutCandidate,
  LeadScoutRunView,
} from "@/features/assistant/assistant-types";
import { AssistantMessage } from "./assistant-message";
import { BookingBriefCard } from "./booking-brief-card";
import { LeadDiscoveryResults } from "./lead-discovery-results";
import { ProfileSearchResults } from "./profile-search-results";
import { ScoutLaunchForm, type RadiusScoutSubmission } from "./scout-launch-form";

const generalPrompts = ["Find a profile", "Who needs follow-up?", "Find profiles in Minnesota", "Find Christmas events"];
type AssistantDrawerMode = "assistant" | "scout";

type ScoutContextPrefill = {
  kind: "booking" | "event_family" | "candidate";
  recordId?: string;
  label: string;
  city?: string;
  region?: string;
  initialDateStart?: string;
  initialDateEnd?: string;
  hasLocation: boolean;
};

function resultHref(result: AssistantProfileSearchResult) {
  if (result.kind === "organization") return `/profiles/${result.id}`;
  if (result.kind === "contact") return `/contacts/${result.id}`;
  return `/event-families/${result.id}`;
}

function isTransientPollFailure(cause: unknown) {
  return cause instanceof TypeError && /failed to fetch|network|load failed|networkerror/i.test(cause.message);
}

function dateOnly(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.slice(0, 10);
}

function shiftDateOnly(value: string | undefined, days: number): string | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function contextualScoutPrefill(
  context: ActiveAssistantContext,
  bundle: AssistantContextBundle | null,
): ScoutContextPrefill | null {
  if (!context || !["booking", "event_family"].includes(context.kind)) return null;
  const currentBooking = bundle && typeof bundle.currentBooking === "object" && bundle.currentBooking
    ? bundle.currentBooking as Record<string, unknown>
    : null;
  const city = typeof currentBooking?.city === "string" ? currentBooking.city : undefined;
  const region = typeof currentBooking?.region === "string" ? currentBooking.region : undefined;
  const startsAt = dateOnly(currentBooking?.startsAt);
  const endsAt = dateOnly(currentBooking?.endsAt) ?? startsAt;
  const location = [city, region].filter(Boolean).join(", ");
  return {
    kind: context.kind as "booking" | "event_family",
    recordId: context.recordId,
    label: context.label || location || "Selected event",
    city,
    region,
    initialDateStart: shiftDateOnly(startsAt, -7),
    initialDateEnd: shiftDateOnly(endsAt, 7),
    hasLocation: Boolean(city || region),
  };
}

function candidateScoutPrefill(candidate: LeadScoutCandidate): ScoutContextPrefill {
  const startsAt = dateOnly(candidate.startsAt);
  const endsAt = dateOnly(candidate.endsAt) ?? startsAt;
  return {
    kind: "candidate",
    recordId: candidate.id,
    label: candidate.name,
    city: candidate.city ?? undefined,
    region: candidate.region ?? undefined,
    initialDateStart: shiftDateOnly(startsAt, -7),
    initialDateEnd: shiftDateOnly(endsAt, 7),
    hasLocation: Boolean(candidate.city && candidate.region),
  };
}

export function AssistantDrawer() {
  const { activeContext, explicitContext, clearExplicitContext, selectExplicitContext, closeAssistant, isOpen, prefill } = useAssistantContext();
  const [, setLocation] = useLocation();
  const [contextBundle, setContextBundle] = useState<AssistantContextBundle | null>(null);
  const [brief, setBrief] = useState<BookingBrief | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<AssistantAnswer[]>([]);
  const [generalResponse, setGeneralResponse] = useState<GeneralAssistantResponse | null>(null);
  const [leadScoutRun, setLeadScoutRun] = useState<LeadScoutRunView | null>(null);
  const [scoutRunHistory, setScoutRunHistory] = useState<LeadScoutRunView[]>([]);
  const [drawerMode, setDrawerMode] = useState<AssistantDrawerMode>("assistant");
  const [scoutPrefill, setScoutPrefill] = useState<ScoutContextPrefill | null>(null);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [scoutActionBusy, setScoutActionBusy] = useState(false);
  const [scoutPollingWarning, setScoutPollingWarning] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generalGeneration = useRef(0);

  const contextKey = useMemo(() => activeContext ? `${activeContext.kind}:${activeContext.recordId}` : "general", [activeContext]);
  const availableContextPrefill = useMemo(
    () => contextualScoutPrefill(activeContext, contextBundle),
    [activeContext, contextBundle],
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuestion(prefill);
  }, [isOpen, prefill]);

  useEffect(() => {
    if (!isOpen) return;
    setAnswers([]); setConversationId(undefined); setContextBundle(null); setBrief(null); setGeneralResponse(null);
    setLeadScoutRun(null); setScoutRunHistory([]); setError(null); setScoutPollingWarning(null); setOffline(false); setSavedAt(null); setScoutPrefill(null);
    if (activeContext) setDrawerMode("assistant");

    let cancelled = false;
    if (!activeContext) {
      if (!navigator.onLine) return;
      const generation = generalGeneration.current;
      void getLatestLeadScoutRun().then((run) => {
        if (!cancelled && generation === generalGeneration.current) setLeadScoutRun(run);
      }).catch(() => undefined);
      return () => { cancelled = true; };
    }

    setLoading(true);
    Promise.all([loadAssistantSnapshot(activeContext), getLatestAssistantConversation(activeContext).catch(() => null)])
      .then(([snapshot, conversation]) => {
        if (cancelled) return;
        setContextBundle(snapshot.context); setBrief(snapshot.brief); setOffline(snapshot.offline); setSavedAt(snapshot.savedAt);
        if (conversation) {
          setConversationId(conversation.id);
          setAnswers(conversation.messages.flatMap((message) => {
            if (message.role !== "assistant" || !message.answerMode || !message.confidence) return [];
            return [{ text: message.body, mode: message.answerMode, confidence: message.confidence, sources: message.sources, needsAdmin: false as const }];
          }));
        }
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "The Booking Assistant could not load this context."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeContext, contextKey, isOpen]);

  useEffect(() => {
    if (!isOpen || !leadScoutRun || !["running", "stopping"].includes(leadScoutRun.status)) return;
    let cancelled = false;
    const runId = leadScoutRun.id;
    const interval = window.setInterval(() => {
      void getLeadScoutRun(runId)
        .then((run) => {
          if (cancelled) return;
          setLeadScoutRun(run);
          setScoutPollingWarning(null);
        })
        .catch((cause) => {
          if (cancelled) return;
          if (isTransientPollFailure(cause)) {
            setScoutPollingWarning("Reconnecting to Lead Scout…");
            return;
          }
          setError(cause instanceof Error ? cause.message : "Could not refresh Lead Scout.");
        });
    }, 1500);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [isOpen, leadScoutRun?.id, leadScoutRun?.status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || asking) return;
    const submitted = question.trim();
    setQuestion(""); setError(null); setAsking(true);
    try {
      if (!activeContext) {
        generalGeneration.current += 1;
        if (!navigator.onLine) {
          setLeadScoutRun(null);
          setGeneralResponse({ kind: "needs_context", text: "I'm offline. General profile search needs a connection because Command Terminal does not cache the full CRM. Previously opened profiles can still be used from their saved context." });
          return;
        }
        const result = await askGeneralAssistant(submitted);
        if (result.kind === "lead_discovery") {
          setGeneralResponse(null);
          setLeadScoutRun(result.run);
          setScoutPrefill(null);
          setScoutRunHistory([]);
          setDrawerMode("scout");
        } else {
          setLeadScoutRun(null);
          setGeneralResponse(result);
        }
        return;
      }
      const result = await askBookingAssistant({ context: activeContext, question: submitted, conversationId });
      setContextBundle(result.context); setBrief(result.brief); setOffline(result.answer.mode === "offline_cached");
      if (result.conversationId) setConversationId(result.conversationId);
      setAnswers((current) => [...current, result.answer]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Booking Assistant could not answer that right now.");
      setQuestion(submitted);
    } finally { setAsking(false); }
  }

  async function runScoutAction(action: () => Promise<LeadScoutRunView>, fallback: string) {
    if (scoutActionBusy) return;
    setScoutActionBusy(true); setError(null);
    try { setLeadScoutRun(await action()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : fallback); }
    finally { setScoutActionBusy(false); }
  }

  function findNewLeads() {
    if (!leadScoutRun) return;
    void runScoutAction(() => startLeadScout(leadScoutRun.id), "Could not start Lead Scout.");
  }

  async function stopSearch() {
    if (!leadScoutRun || scoutActionBusy) return;
    const previous = leadScoutRun;
    setLeadScoutRun({ ...leadScoutRun, status: "stopping", progress: { ...leadScoutRun.progress, label: "Stopping…" } });
    setScoutActionBusy(true); setError(null);
    try { setLeadScoutRun(await stopLeadScout(previous.id)); }
    catch (cause) { setLeadScoutRun(previous); setError(cause instanceof Error ? cause.message : "Could not stop Lead Scout."); }
    finally { setScoutActionBusy(false); }
  }

  function continueSearch() {
    if (!leadScoutRun) return;
    void runScoutAction(() => continueLeadScout(leadScoutRun.id), "Could not continue Lead Scout.");
  }

  function researchDeeper(candidateId: string) {
    if (!leadScoutRun) return;
    void runScoutAction(
      () => deepenLeadScoutCandidate(leadScoutRun.id, candidateId),
      "Could not research this prospect deeper.",
    );
  }

  function markNotFit(candidateId: string) {
    if (!leadScoutRun) return;
    void runScoutAction(
      () => dismissLeadScoutCandidate(leadScoutRun.id, candidateId),
      "Could not mark this prospect Not a fit.",
    );
  }

  async function saveScoutCandidate(
    candidateId: string,
    submission: LeadScoutSaveSubmission,
  ): Promise<LeadScoutSaveResult> {
    if (!leadScoutRun) throw new Error("No Lead Scout run is selected.");
    if (scoutActionBusy) throw new Error("Another Scout action is still finishing.");
    setScoutActionBusy(true);
    setError(null);
    try {
      const result = await saveLeadScoutCandidate(leadScoutRun.id, candidateId, submission);
      setLeadScoutRun(result.run);
      return result;
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error("Could not save this prospect as a lead.");
      setError(failure.message);
      throw failure;
    } finally {
      setScoutActionBusy(false);
    }
  }

  async function handleScoutLaunch(submission: RadiusScoutSubmission) {
    if (scoutActionBusy) return;
    setScoutActionBusy(true);
    setError(null);
    try {
      const usingContext = scoutPrefill && submission.anchorLabel.trim() === scoutPrefill.label.trim();
      const anchor: RadiusScoutRequest["anchor"] = usingContext
        ? {
            kind: scoutPrefill.kind,
            recordId: scoutPrefill.recordId,
            label: scoutPrefill.label,
            city: scoutPrefill.city,
            region: scoutPrefill.region,
          }
        : { kind: "manual", label: submission.anchorLabel.trim() };
      const { startRadiusLeadScout } = await import("@/features/assistant/lead-scout-api");
      const run = await startRadiusLeadScout({
        anchor,
        radiusMiles: submission.radiusMiles,
        dateStart: submission.dateStart,
        dateEnd: submission.dateEnd,
        categories: submission.categories,
        historyFilter: submission.historyFilter,
      });
      setLeadScoutRun(run);
      setDrawerMode("scout");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Radius Scout.");
    } finally {
      setScoutActionBusy(false);
    }
  }

  function launchContextScout() {
    if (!availableContextPrefill) return;
    setScoutPrefill(availableContextPrefill);
    setScoutRunHistory([]);
    setLeadScoutRun(null);
    setError(availableContextPrefill.hasLocation ? null : "This event has no saved location yet. Enter a city, state, or address before scouting.");
    setDrawerMode("scout");
  }

  function launchCandidateScout(candidate: LeadScoutCandidate) {
    const nextPrefill = candidateScoutPrefill(candidate);
    if (leadScoutRun) setScoutRunHistory((current) => [...current, leadScoutRun]);
    setScoutPrefill(nextPrefill);
    setLeadScoutRun(null);
    setError(nextPrefill.hasLocation ? null : "This Scout result needs a city and state before it can be used as a new anchor.");
    setDrawerMode("scout");
  }

  function restorePreviousScoutRun() {
    const previous = scoutRunHistory[scoutRunHistory.length - 1];
    if (!previous) return;
    setLeadScoutRun(previous);
    setScoutPrefill(null);
    setError(null);
    setDrawerMode("scout");
    setScoutRunHistory((current) => current.slice(0, -1));
  }

  function useResultAsContext(result: AssistantProfileSearchResult) {
    selectExplicitContext({ kind: result.kind, recordId: result.id, label: result.label });
    setGeneralResponse(null); setLeadScoutRun(null); setScoutRunHistory([]); setQuestion("");
  }
  function openResult(result: AssistantProfileSearchResult) { clearExplicitContext(); setLocation(resultHref(result)); }
  function useLeadMatchAsContext(match: AssistantLeadMatch) {
    selectExplicitContext({ kind: "organization", recordId: match.organizationId, label: match.label });
    setGeneralResponse(null); setLeadScoutRun(null); setScoutRunHistory([]); setQuestion("");
  }
  function openLeadMatch(match: AssistantLeadMatch) { clearExplicitContext(); setLocation(`/profiles/${match.organizationId}`); }

  if (!isOpen) return null;
  const generalMode = !activeContext;
  const contextualScoutMode = Boolean(activeContext && drawerMode === "scout");
  const results = generalResponse?.kind === "profile_results" ? generalResponse.results : [];
  const previousScoutAvailable = scoutRunHistory.length > 0;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/25" role="presentation">
      <section aria-label="Booking Assistant" className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-orange-100 text-orange-700"><Bot className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1"><h2 className="font-bold text-slate-950">Booking Assistant</h2><p className="truncate text-xs text-slate-500">{activeContext?.label ?? "General Command Terminal · No profile selected"}</p></div>
          {explicitContext ? <button className="text-xs font-semibold text-orange-700 hover:underline" onClick={clearExplicitContext} type="button">Clear selected context</button> : null}
          <button aria-label="Close Booking Assistant" className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={closeAssistant} type="button"><X className="h-5 w-5" /></button>
        </header>
        {offline ? <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800"><WifiOff className="h-4 w-4" />Offline — using saved Command Terminal data{savedAt ? ` from ${new Date(savedAt).toLocaleString()}` : ""}.</div> : null}
        <div className="flex-1 overflow-y-auto p-4">
          {generalMode ? (
            <div className="grid gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="font-bold text-slate-950">General Command Terminal</h3>
                <p className="mt-1 text-sm text-slate-600">Find existing Command Center records with Ask Assistant, or use Scout Events to hunt for new opportunities around a location.</p>
                <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Assistant mode">
                  <button
                    className={drawerMode === "assistant" ? "button-primary" : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}
                    onClick={() => { setDrawerMode("assistant"); setError(null); }}
                    type="button"
                  >Ask Assistant</button>
                  <button
                    className={drawerMode === "scout" ? "button-primary" : "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}
                    onClick={() => { setScoutPrefill(null); setScoutRunHistory([]); setDrawerMode("scout"); setError(null); }}
                    type="button"
                  >Scout Events</button>
                </div>
                {drawerMode === "assistant" ? <div className="mt-3 flex flex-wrap gap-2">{generalPrompts.map((prompt) => <button className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-100" key={prompt} onClick={() => setQuestion(prompt)} type="button">{prompt}</button>)}</div> : null}
              </div>

              {drawerMode === "scout" && previousScoutAvailable ? (
                <button className="button-secondary" onClick={restorePreviousScoutRun} type="button">Back to Previous Scout Results</button>
              ) : null}
              {drawerMode === "scout" && !leadScoutRun ? (
                <ScoutLaunchForm
                  disabled={scoutActionBusy}
                  initialAnchor={scoutPrefill?.label ?? ""}
                  initialDateStart={scoutPrefill?.initialDateStart ?? ""}
                  initialDateEnd={scoutPrefill?.initialDateEnd ?? ""}
                  key={scoutPrefill ? `${scoutPrefill.kind}:${scoutPrefill.recordId ?? scoutPrefill.label}` : "general-scout"}
                  onSubmit={handleScoutLaunch}
                />
              ) : null}
              {drawerMode === "assistant" && generalResponse ? <p className="text-sm text-slate-700">{generalResponse.kind === "answer" ? generalResponse.answer.text : generalResponse.text}</p> : null}
              {drawerMode === "scout" && leadScoutRun ? (
                <LeadDiscoveryResults
                  run={leadScoutRun}
                  webScoutAvailable
                  onOpenProfile={openLeadMatch}
                  onUseContext={useLeadMatchAsContext}
                  onFindNewLeads={findNewLeads}
                  onStopSearch={() => { void stopSearch(); }}
                  onContinueSearch={continueSearch}
                  onResearchDeeper={researchDeeper}
                  onNotFit={markNotFit}
                  onSaveCandidate={saveScoutCandidate}
                  onScoutAroundCandidate={launchCandidateScout}
                />
              ) : null}
              {drawerMode === "assistant" ? <ProfileSearchResults results={results} onOpenProfile={openResult} onUseContext={useResultAsContext} /> : null}
              {scoutPollingWarning ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{scoutPollingWarning}</p> : null}
              {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
            </div>
          ) : loading ? <p className="py-10 text-center text-sm text-slate-500">Building Booking Brief…</p> : contextualScoutMode ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">Scouting around {scoutPrefill?.label ?? activeContext?.label ?? "this event"}</p>
                <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => { setDrawerMode("assistant"); setScoutRunHistory([]); setError(null); }} type="button">Back to Assistant</button>
              </div>
              {previousScoutAvailable ? (
                <button className="button-secondary" onClick={restorePreviousScoutRun} type="button">Back to Previous Scout Results</button>
              ) : null}
              {!leadScoutRun ? (
                <ScoutLaunchForm
                  disabled={scoutActionBusy}
                  initialAnchor={scoutPrefill?.label ?? availableContextPrefill?.label ?? ""}
                  initialDateStart={scoutPrefill?.initialDateStart ?? availableContextPrefill?.initialDateStart ?? ""}
                  initialDateEnd={scoutPrefill?.initialDateEnd ?? availableContextPrefill?.initialDateEnd ?? ""}
                  key={`${scoutPrefill?.kind ?? activeContext?.kind}:${scoutPrefill?.recordId ?? activeContext?.recordId ?? scoutPrefill?.label ?? "scout"}`}
                  onSubmit={handleScoutLaunch}
                />
              ) : (
                <LeadDiscoveryResults
                  run={leadScoutRun}
                  webScoutAvailable
                  onOpenProfile={openLeadMatch}
                  onUseContext={useLeadMatchAsContext}
                  onFindNewLeads={findNewLeads}
                  onStopSearch={() => { void stopSearch(); }}
                  onContinueSearch={continueSearch}
                  onResearchDeeper={researchDeeper}
                  onNotFit={markNotFit}
                  onSaveCandidate={saveScoutCandidate}
                  onScoutAroundCandidate={launchCandidateScout}
                />
              )}
              {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
            </div>
          ) : (
            <div className="grid gap-4">
              {availableContextPrefill ? (
                <button className="button-primary w-full" onClick={launchContextScout} type="button">Scout Around This Event</button>
              ) : null}
              {brief ? <BookingBriefCard brief={brief} context={contextBundle} /> : null}
              {answers.length > 0 ? <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Conversation</p> : null}
              {answers.map((answer, index) => <AssistantMessage answer={answer} key={`${answer.mode}-${index}`} />)}
              {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
            </div>
          )}
        </div>
        {(generalMode ? drawerMode === "assistant" : !contextualScoutMode) ? (
          <form className="border-t border-slate-200 bg-white p-4" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="booking-assistant-question">Ask Booking Assistant</label>
            <textarea className="min-h-20 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" disabled={asking} id="booking-assistant-question" maxLength={4000} onChange={(event) => setQuestion(event.currentTarget.value)} placeholder={generalMode ? "Find a profile, or ask for events by date, state, route, or leg…" : "Ask what happened last year, what they normally book, what you may be forgetting…"} value={question} />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">{generalMode ? "General search uses structured Command Terminal records first." : offline ? "Offline questions use the saved brief when possible." : "Routine questions use saved Command Terminal data first."}</p>
              <button className="button-primary min-w-24" disabled={asking || !question.trim()} type="submit">{asking ? "Thinking…" : "Ask"}</button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}