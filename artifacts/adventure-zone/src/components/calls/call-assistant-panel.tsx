"use client";

import { useMemo, useState } from "react";

import { askBookingAssistantLocalFirst } from "@/features/assistant/on-device-ai-assistant";
import { saveNeedsAnswer } from "@/features/assistant/needs-answer-api";
import type { ActiveAssistantContext } from "@/features/assistant/assistant-types";

export function CallAssistantPanel({
  organizationId,
  contactId,
  bookingId,
  followUpId,
}: {
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  followUpId: string | null;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const context = useMemo<Exclude<ActiveAssistantContext, null> | null>(() => {
    if (bookingId) return { kind: "booking", recordId: bookingId };
    if (contactId) return { kind: "contact", recordId: contactId };
    if (organizationId) return { kind: "organization", recordId: organizationId };
    return null;
  }, [bookingId, contactId, organizationId]);

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    setConfidence(null);
    setSaved(false);
    try {
      if (!context) {
        setError("There isn't enough linked CRM context to answer this safely.");
        return;
      }
      const result = await askBookingAssistantLocalFirst({ context, question: trimmed });
      setAnswer(result.answer.text);
      setConfidence(result.answer.confidence);
    } catch {
      setError("I couldn't get a reliable answer from Command Center right now.");
    } finally {
      setAsking(false);
    }
  }

  async function saveForLater() {
    const trimmed = question.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await saveNeedsAnswer({
        question: trimmed,
        organizationId,
        contactId,
        bookingId,
        followUpId,
        userNote: answer && confidence === "low"
          ? `Assistant returned a low-confidence answer: ${answer}`
          : null,
      });
      setSaved(true);
    } catch {
      setError("Could not save this question to Needs Answer. Your question is still here so you can retry.");
    } finally {
      setSaving(false);
    }
  }

  const needsAnswer = Boolean(error) || confidence === "low";

  return (
    <section
      aria-labelledby="call-assistant-title"
      className="rounded-xl border border-violet-200 bg-violet-50 p-5 shadow-sm"
      data-testid="call-assistant"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-700">Call help</p>
          <h2 className="mt-1 text-xl font-bold" id="call-assistant-title">Ask Assistant</h2>
        </div>
        <a className="text-sm font-semibold text-violet-800 underline" href="/needs-answer">Needs Answer</a>
      </div>
      <p className="mt-2 text-sm text-slate-700">
        Ask about this contact, event, package history, follow-up, or saved Adventure Zone information. It won't make up missing prices or promises.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="Ask Assistant during call"
          className="min-w-0 flex-1"
          onChange={(event) => {
            setQuestion(event.target.value);
            setSaved(false);
          }}
          placeholder="What should I tell them about…?"
          value={question}
        />
        <button className="button-secondary" disabled={asking || !question.trim()} onClick={() => void ask()} type="button">
          {asking ? "Checking…" : "Ask"}
        </button>
      </div>
      {answer ? (
        <div className="mt-3 rounded-lg border border-violet-200 bg-white p-3 text-sm text-slate-800">
          <p>{answer}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Confidence: {confidence}</p>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
      {needsAnswer ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-950">This one needs a confirmed answer.</p>
          <button className="button-secondary mt-2" disabled={saving || saved} onClick={() => void saveForLater()} type="button">
            {saved ? "Saved to Needs Answer" : saving ? "Saving…" : "Save to Needs Answer"}
          </button>
        </div>
      ) : null}
    </section>
  );
}