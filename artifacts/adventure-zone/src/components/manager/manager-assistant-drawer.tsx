import { useEffect, useState, type FormEvent } from "react";
import { Bot, Send, WifiOff, X } from "lucide-react";

import { useManagerAuth } from "@/lib/manager-auth-context";
import {
  askAdminFromManager,
  askManagerAssistant,
  listManagerAdminQuestions,
  loadManagerAssistantContext,
} from "@/features/manager-assistant/manager-assistant-api";
import { useManagerAssistant } from "@/features/manager-assistant/manager-assistant-context";
import type {
  ManagerAdminQuestion,
  ManagerAssistantAnswer,
  ManagerAssistantContextBundle,
} from "@/features/manager-assistant/manager-assistant-types";

function statusLabel(status: ManagerAdminQuestion["status"]) {
  return status === "needs_answer" ? "Needs answer" : status === "answered" ? "Answered" : "Resolved";
}

export function ManagerAssistantDrawer() {
  const { manager, managerApi } = useManagerAuth();
  const { activeContext, closeAssistant, open, prefill } = useManagerAssistant();
  const [context, setContext] = useState<ManagerAssistantContextBundle | null>(null);
  const [answer, setAnswer] = useState<ManagerAssistantAnswer | null>(null);
  const [question, setQuestion] = useState("");
  const [questions, setQuestions] = useState<ManagerAdminQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuestion(prefill);
  }, [open, prefill]);

  useEffect(() => {
    if (!open || !activeContext || !manager) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      loadManagerAssistantContext(managerApi, manager.legId, activeContext),
      listManagerAdminQuestions(managerApi).catch(() => ({ questions: [] })),
    ])
      .then(([ctx, questionList]) => {
        if (cancelled) return;
        setContext(ctx.context);
        setOffline(ctx.offline);
        setQuestions(questionList.questions);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the Operations Assistant.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeContext, manager, managerApi, open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!activeContext || !manager || !question.trim() || asking) return;
    setAsking(true);
    setError(null);
    setNotice(null);
    setAnswer(null);
    try {
      const result = await askManagerAssistant(managerApi, manager.legId, activeContext, question.trim());
      setContext(result.context);
      setAnswer(result.answer);
      setOffline(result.offline);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The assistant could not answer that.");
    } finally {
      setAsking(false);
    }
  }

  async function askAdmin(urgency: "normal" | "urgent") {
    if (!manager || !activeContext || !answer?.needsAdmin || !question.trim()) return;
    setAsking(true);
    setError(null);
    try {
      const result = await askAdminFromManager({
        managerApi,
        legId: manager.legId,
        context: activeContext,
        question: question.trim(),
        urgency,
        escalationReason: answer.escalationReason ?? "Operations Assistant could not answer confidently.",
      });
      setNotice(
        result.state === "saved_offline"
          ? "Saved offline — this question will send automatically when you're connected."
          : "Sent to the admins. Their reply will appear here.",
      );
      if (result.question) setQuestions((current) => [result.question!, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the question to admins.");
    } finally {
      setAsking(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30">
      <section className="flex h-full w-full max-w-lg flex-col bg-slate-50 shadow-2xl" aria-label="Operations Assistant">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white p-4">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-orange-100 text-orange-700"><Bot className="h-5 w-5"/></div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">Operations Assistant</h2>
            <p className="truncate text-xs text-slate-500">{activeContext?.label ?? manager?.legName ?? "Your leg"}</p>
          </div>
          <button aria-label="Close Operations Assistant" className="rounded-lg p-2 hover:bg-slate-100" onClick={closeAssistant} type="button"><X className="h-5 w-5"/></button>
        </header>
        {offline ? <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800"><WifiOff className="h-4 w-4"/>Offline — using saved leg data</div> : null}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? <p className="text-sm text-slate-500">Loading your leg information…</p> : null}
          {context ? (
            <div className="grid gap-3">
              {context.activeEvent ? null : context.assignedEvents[0] ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-orange-700">Next assigned event</p>
                  <p className="mt-1 font-bold">{context.assignedEvents[0].name}</p>
                  <p className="text-sm text-slate-600">{[context.assignedEvents[0].city, context.assignedEvents[0].region].filter(Boolean).join(", ")}</p>
                </div>
              ) : null}
              {answer ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm whitespace-pre-wrap text-slate-800">{answer.text}</p>
                  <p className="mt-2 text-xs font-semibold uppercase text-slate-500">{answer.confidence} confidence · {answer.mode}</p>
                  {answer.needsAdmin ? (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-semibold text-amber-900">I need an admin to confirm this.</p>
                      <p className="mt-1 text-xs text-amber-800">Your current leg/event context will be attached automatically.</p>
                      <div className="mt-3 flex gap-2">
                        <button className="button-primary" disabled={asking} onClick={() => void askAdmin("normal")} type="button">Ask Admin</button>
                        <button className="button-secondary" disabled={asking} onClick={() => void askAdmin("urgent")} type="button">Mark urgent</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p> : null}
              {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}

              {questions.length ? (
                <details className="rounded-xl border border-slate-200 bg-white p-4" open={questions.some((item) => item.status === "answered")}>
                  <summary className="cursor-pointer font-semibold">Questions sent to admins ({questions.length})</summary>
                  <ul className="mt-3 grid gap-2">
                    {questions.slice(0, 8).map((item) => (
                      <li className="rounded-lg bg-slate-50 p-3 text-sm" key={item.id}>
                        <div className="flex items-start justify-between gap-2"><span>{item.question}</span><span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold">{statusLabel(item.status)}</span></div>
                        {item.latestAdminResponse ? <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Admin answer</p><p className="mt-1 whitespace-pre-wrap text-sm text-emerald-950">{item.latestAdminResponse}</p></div> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <form className="border-t border-slate-200 bg-white p-4" onSubmit={submit}>
          <textarea
            className="min-h-20 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
            maxLength={4000}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about setup, equipment, route, meetups, or your next event…"
            value={question}
          />
          <button className="button-primary mt-2 flex items-center gap-2" disabled={!activeContext || asking || !question.trim()} type="submit"><Send className="h-4 w-4"/>{asking ? "Checking…" : "Ask"}</button>
        </form>
      </section>
    </div>
  );
}
