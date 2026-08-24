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
} from "@/features/assistant/lead-scout-api";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import type {
  AssistantAnswer,
  AssistantContextBundle,
  AssistantLeadMatch,
  AssistantProfileSearchResult,
  BookingBrief,
  GeneralAssistantResponse,
  LeadScoutRunView,
} from "@/features/assistant/assistant-types";
import { AssistantMessage } from "./assistant-message";
import { BookingBriefCard } from "./booking-brief-card";
import { LeadDiscoveryResults } from "./lead-discovery-results";
import { ProfileSearchResults } from "./profile-search-results";

const generalPrompts = ["Find a profile", "Who needs follow-up?", "Find profiles in Minnesota", "Find Christmas events"];

function resultHref(result: AssistantProfileSearchResult) {
  if (result.kind === "organization") return `/profiles/${result.id}`;
  if (result.kind === "contact") return `/contacts/${result.id}`;
  return `/event-families/${result.id}`;
}

function isTransientPollFailure(cause: unknown) {
  return cause instanceof TypeError && /failed to fetch|network|load failed|networkerror/i.test(cause.message);
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
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [scoutActionBusy, setScoutActionBusy] = useState(false);
  const [scoutPollingWarning, setScoutPollingWarning] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generalGeneration = useRef(0);

  const contextKey = useMemo(() => activeContext ? `${activeContext.kind}:${activeContext.recordId}` : "general", [activeContext]);

  useEffect(() => {
    if (!isOpen) return;
    setQuestion(prefill);
  }, [isOpen, prefill]);

  useEffect(() => {
    if (!isOpen) return;
    setAnswers([]); setConversationId(undefined); setContextBundle(null); setBrief(null); setGeneralResponse(null);
    setLeadScoutRun(null); setError(null); setScoutPollingWarning(null); setOffline(false); setSavedAt(null);

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
    if (!isOpen || activeContext || !leadScoutRun || !["running", "stopping"].includes(leadScoutRun.status)) return;
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
  }, [activeContext, isOpen, leadScoutRun?.id, leadScoutRun?.status]);

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
        if (result.kind === "lead_discovery") { setGeneralResponse(null); setLeadScoutRun(result.run); }
        else { setLeadScoutRun(null); setGeneralResponse(result); }
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

  function useResultAsContext(result: AssistantProfileSearchResult) {
    selectExplicitContext({ kind: result.kind, recordId: result.id, label: result.label });
    setGeneralResponse(null); setLeadScoutRun(null); setQuestion("");
  }
  function openResult(result: AssistantProfileSearchResult) { clearExplicitContext(); setLocation(resultHref(result)); }
  function useLeadMatchAsContext(match: AssistantLeadMatch) {
    selectExplicitContext({ kind: "organization", recordId: match.organizationId, label: match.label });
    setGeneralResponse(null); setLeadScoutRun(null); setQuestion("");
  }
  function openLeadMatch(match: AssistantLeadMatch) { clearExplicitContext(); setLocation(`/profiles/${match.organizationId}`); }

  if (!isOpen) return null;
  const generalMode = !activeContext;
  const results = generalResponse?.kind === "profile_results" ? generalResponse.results : [];

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
                <p className="mt-1 text-sm text-slate-600">Find a customer, contact, event family, seasonal event, overdue follow-up, or ask for events in a specific date/route area. Pick a result and I’ll use it for your next questions.</p>
                <div className="mt-3 flex flex-wrap gap-2">{generalPrompts.map((prompt) => <button className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-100" key={prompt} onClick={() => setQuestion(prompt)} type="button">{prompt}</button>)}</div>
              </div>
              {generalResponse ? <p className="text-sm text-slate-700">{generalResponse.kind === "answer" ? generalResponse.answer.text : generalResponse.text}</p> : null}
              {leadScoutRun ? (
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
                />
              ) : null}
              <ProfileSearchResults results={results} onOpenProfile={openResult} onUseContext={useResultAsContext} />
              {scoutPollingWarning ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{scoutPollingWarning}</p> : null}
              {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
            </div>
          ) : loading ? <p className="py-10 text-center text-sm text-slate-500">Building Booking Brief…</p> : (
            <div className="grid gap-4">
              {brief ? <BookingBriefCard brief={brief} context={contextBundle} /> : null}
              {answers.length > 0 ? <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Conversation</p> : null}
              {answers.map((answer, index) => <AssistantMessage answer={answer} key={`${answer.mode}-${index}`} />)}
              {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
            </div>
          )}
        </div>
        <form className="border-t border-slate-200 bg-white p-4" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="booking-assistant-question">Ask Booking Assistant</label>
          <textarea className="min-h-20 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200" disabled={asking} id="booking-assistant-question" maxLength={4000} onChange={(event) => setQuestion(event.currentTarget.value)} placeholder={generalMode ? "Find a profile, or ask for events by date, state, route, or leg…" : "Ask what happened last year, what they normally book, what you may be forgetting…"} value={question} />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">{generalMode ? "General search uses structured Command Terminal records first." : offline ? "Offline questions use the saved brief when possible." : "Routine questions use saved Command Terminal data first."}</p>
            <button className="button-primary min-w-24" disabled={asking || !question.trim()} type="submit">{asking ? "Thinking…" : "Ask"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
