"use client";

import type { CallScriptKind } from "@/features/calls/call-types";

export const callScriptPrompts: Record<CallScriptKind, string[]> = {
  first_outreach: [
    "Introduce The Adventure Zone as a traveling inflatable carnival",
    "Ask what kind of crowd and experience they are planning",
    "Confirm the event date, location, attendance, and age mix",
    "Explore bounce houses, slides, obstacle courses, adrenaline attractions, carnival games, or a mixed setup",
    "Confirm who helps decide on entertainment",
    "Agree on one dated next step",
  ],
  follow_up: [
    "Reference the saved reason for calling and the last conversation",
    "Ask what would help them choose the right attraction mix",
    "Confirm whether the event, crowd, space, or priorities changed",
    "Answer only confirmed package, setup, and pricing questions",
    "Agree on one dated next step",
  ],
  contract_follow_up: [
    "Confirm they received the proposal or contract",
    "Ask whether the attraction mix, setup, or pricing needs clarification",
    "Confirm the decision and deposit timing",
    "Agree on one dated next step",
  ],
  incoming_inquiry: [
    "Welcome them to The Adventure Zone and ask about the experience they want",
    "Confirm event date, location, attendance, and age mix",
    "Explore bounce houses, giant slides, obstacle courses, adrenaline attractions, and carnival games",
    "Capture the decision-maker and best callback details",
    "Agree on one dated next step",
  ],
};

const labels: Record<CallScriptKind, string> = {
  first_outreach: "First outreach",
  follow_up: "Follow-up",
  contract_follow_up: "Contract follow-up",
  incoming_inquiry: "Incoming inquiry",
};

export function CallScriptCard({
  kind,
  initialKind,
  initialPrompts,
  onChange,
}: {
  kind: CallScriptKind;
  initialKind: CallScriptKind;
  initialPrompts: string[];
  onChange: (kind: CallScriptKind) => void;
}) {
  const prompts =
    kind === initialKind && initialPrompts.length
      ? initialPrompts
      : callScriptPrompts[kind];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="conversation-guide-title">
      <h2 className="text-xl font-bold" id="conversation-guide-title">Conversation guide</h2>
      <label className="mt-3 grid gap-1.5 font-medium">
        Call script
        <select
          onChange={(event) => onChange(event.target.value as CallScriptKind)}
          value={kind}
        >
          {(Object.keys(labels) as CallScriptKind[]).map((value) => (
            <option key={value} value={value}>{labels[value]}</option>
          ))}
        </select>
      </label>
      <ol className="mt-4 grid list-decimal gap-2 pl-5 text-sm">
        {prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}
      </ol>
    </section>
  );
}