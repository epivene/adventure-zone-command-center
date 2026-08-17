import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bot, X } from "lucide-react";

import {
  askBookingAssistant,
  getAssistantContext,
  getBookingBrief,
} from "@/features/assistant/assistant-api";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import type {
  AssistantAnswer,
  AssistantContextBundle,
  BookingBrief,
} from "@/features/assistant/assistant-types";
import { AssistantMessage } from "./assistant-message";
import { BookingBriefCard } from "./booking-brief-card";

export function AssistantDrawer() {
  const { activeContext, closeAssistant, isOpen, prefill } = useAssistantContext();
  const [contextBundle, setContextBundle] = useState<AssistantContextBundle | null>(null);
  const [brief, setBrief] = useState<BookingBrief | null>(null);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<AssistantAnswer[]>([]);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextKey = useMemo(
    () =>
      activeContext
        ? `${activeContext.kind}:${activeContext.recordId}`
        : "none",
    [activeContext],
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuestion(prefill);
  }, [isOpen, prefill]);

  useEffect(() => {
    if (!isOpen) return;
    setAnswers([]);
    setContextBundle(null);
    setBrief(null);
    setError(null);

    if (!activeContext) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getAssistantContext(activeContext),
      getBookingBrief(activeContext),
    ])
      .then(([context, nextBrief]) => {
        if (cancelled) return;
        setContextBundle(context);
        setBrief(nextBrief);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "The Booking Assistant could not load this context.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeContext, contextKey, isOpen]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeContext || !question.trim() || asking) return;
    const submitted = question.trim();
    setQuestion("");
    setError(null);
    setAsking(true);
    try {
      const result = await askBookingAssistant({
        context: activeContext,
        question: submitted,
      });
      setContextBundle(result.context);
      setBrief(result.brief);
      setAnswers((current) => [...current, result.answer]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Booking Assistant could not answer that right now.",
      );
      setQuestion(submitted);
    } finally {
      setAsking(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/25" role="presentation">
      <section
        aria-label="Booking Assistant"
        className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-slate-50 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-orange-100 text-orange-700">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-slate-950">Booking Assistant</h2>
            <p className="truncate text-xs text-slate-500">
              {activeContext?.label ?? "Open a booking or profile for contextual help"}
            </p>
          </div>
          <button
            aria-label="Close Booking Assistant"
            className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={closeAssistant}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {!activeContext ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
              Open a booking first. As more contexts are connected, this same assistant will also follow you through profiles, event families, calls, and routes.
            </div>
          ) : loading ? (
            <p className="py-10 text-center text-sm text-slate-500">Building Booking Brief…</p>
          ) : (
            <div className="grid gap-4">
              {brief ? <BookingBriefCard brief={brief} context={contextBundle} /> : null}
              {answers.map((answer, index) => (
                <AssistantMessage answer={answer} key={`${answer.mode}-${index}`} />
              ))}
              {error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <form className="border-t border-slate-200 bg-white p-4" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="booking-assistant-question">
            Ask Booking Assistant
          </label>
          <textarea
            className="min-h-20 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
            disabled={!activeContext || asking}
            id="booking-assistant-question"
            maxLength={4000}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            placeholder="Ask what happened last year, what they normally book, what you may be forgetting…"
            value={question}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Routine questions use saved Command Center data first.
            </p>
            <button
              className="button-primary min-w-24"
              disabled={!activeContext || asking || !question.trim()}
              type="submit"
            >
              {asking ? "Thinking…" : "Ask"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
