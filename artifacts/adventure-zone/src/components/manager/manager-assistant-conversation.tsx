import { useEffect, useState, type FormEvent } from "react";
import { Bot, Send, WifiOff } from "lucide-react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import {
  askAdminFromManager,
  askManagerAssistant,
  listManagerAdminQuestions,
  loadManagerAssistantContext,
} from "@/features/manager-assistant/manager-assistant-api";
import { useManagerAssistant } from "@/features/manager-assistant/manager-assistant-context";
import type { ManagerAdminQuestion, ManagerAssistantAnswer, ManagerAssistantContextBundle } from "@/features/manager-assistant/manager-assistant-types";

export function ManagerAssistantConversation({ initialPrefill = "" }: { initialPrefill?: string }) {
  const { manager, managerApi } = useManagerAuth();
  const { activeContext } = useManagerAssistant();
  const [context, setContext] = useState<ManagerAssistantContextBundle | null>(null);
  const [answer, setAnswer] = useState<ManagerAssistantAnswer | null>(null);
  const [question, setQuestion] = useState(initialPrefill);
  const [questions, setQuestions] = useState<ManagerAdminQuestion[]>([]);
  const [asking, setAsking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setQuestion(initialPrefill), [initialPrefill]);

  useEffect(() => {
    if (!activeContext || !manager) return;
    let cancelled = false;
    Promise.all([
      loadManagerAssistantContext(managerApi, manager.legId, activeContext),
      listManagerAdminQuestions(managerApi).catch(() => ({ questions: [] })),
    ]).then(([ctx, adminQuestions]) => {
      if (cancelled) return;
      setContext(ctx.context);
      setOffline(ctx.offline);
      setQuestions(adminQuestions.questions);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the Operations Assistant.");
    });
    return () => { cancelled = true; };
  }, [activeContext, manager, managerApi]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!activeContext || !manager || !question.trim() || asking) return;
    setAsking(true); setError(null); setNotice(null); setAnswer(null);
    try {
      const result = await askManagerAssistant(managerApi, manager.legId, activeContext, question.trim());
      setContext(result.context); setAnswer(result.answer); setOffline(result.offline);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The assistant could not answer that.");
    } finally { setAsking(false); }
  }

  async function askAdmin(urgency: "normal" | "urgent") {
    if (!manager || !activeContext || !answer?.needsAdmin || !question.trim()) return;
    setAsking(true); setError(null);
    try {
      const result = await askAdminFromManager({
        managerApi,
        legId: manager.legId,
        context: activeContext,
        question: question.trim(),
        urgency,
        escalationReason: answer.escalationReason ?? "Operations Assistant could not answer confidently.",
      });
      setNotice(result.state === "saved_offline" ? "Saved offline — this will send when you're connected." : "Sent to the admins. Their reply will appear here.");
      if (result.question) setQuestions((current) => [result.question!, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the question to admins.");
    } finally { setAsking(false); }
  }

  return <div className="grid gap-3">
    <div className="flex items-center gap-3 rounded-xl border bg-white p-4">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-orange-100 text-orange-700"><Bot className="h-5 w-5" /></div>
      <div><h2 className="font-bold">Operations Assistant</h2><p className="text-xs text-slate-500">{activeContext?.label ?? manager?.legName ?? "Your leg"}</p></div>
    </div>
    {offline ? <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800"><WifiOff className="h-4 w-4"/>Offline — using saved leg data</div> : null}
    {context && !context.activeEvent && context.assignedEvents[0] ? <div className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-orange-700">Next assigned event</p><p className="mt-1 font-bold">{context.assignedEvents[0].name}</p><p className="text-sm text-slate-600">{[context.assignedEvents[0].city, context.assignedEvents[0].region].filter(Boolean).join(", ")}</p></div> : null}
    {answer ? <div className="rounded-xl border bg-white p-4"><p className="whitespace-pre-wrap text-sm">{answer.text}</p><p className="mt-2 text-xs font-semibold uppercase text-slate-500">{answer.confidence} confidence · {answer.mode}</p>{answer.needsAdmin ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold text-amber-900">I need an admin to confirm this.</p><div className="mt-3 flex gap-2"><button className="button-primary" disabled={asking} onClick={() => void askAdmin("normal")} type="button">Ask Admin</button><button className="button-secondary" disabled={asking} onClick={() => void askAdmin("urgent")} type="button">Mark urgent</button></div></div> : null}</div> : null}
    {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</p> : null}
    {questions.length ? <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold">Questions sent to admins ({questions.length})</summary><div className="mt-3 grid gap-2">{questions.slice(0,8).map((item) => <div className="rounded-lg bg-slate-50 p-3 text-sm" key={item.id}><p>{item.question}</p>{item.latestAdminResponse ? <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-950"><b>Admin:</b> {item.latestAdminResponse}</p> : null}</div>)}</div></details> : null}
    {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    <form className="rounded-xl border bg-white p-3" onSubmit={submit}><textarea aria-label="Ask Operations Assistant" className="min-h-24 w-full rounded-lg border p-3" maxLength={4000} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about setup, equipment, route, check-in, meetups, or your next event…" value={question}/><div className="mt-2 flex justify-end"><button className="button-primary" disabled={!activeContext || asking || !question.trim()} type="submit"><Send className="mr-1 inline h-4 w-4"/>{asking ? "Checking…" : "Ask"}</button></div></form>
  </div>;
}
