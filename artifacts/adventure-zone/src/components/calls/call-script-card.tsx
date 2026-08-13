"use client";

import type { CallScriptKind } from "@/features/calls/call-types";

export const callScriptPrompts: Record<CallScriptKind, string[]> = {
  first_outreach: [
    "Introduce Adventure Zone",
    "Confirm the event date and location",
    "Ask expected attendance",
    "Ask which package interests them",
    "Confirm the decision-maker",
    "Agree on the next step",
  ],
  follow_up: [
    "Reference the previous conversation",
    "Confirm what changed",
    "Ask about concerns",
    "Confirm package interest",
    "Agree on the next step",
  ],
  contract_follow_up: [
    "Confirm they received the proposal or contract",
    "Ask whether anything needs clarification",
    "Confirm deposit and decision timing",
    "Agree on the next step",
  ],
  incoming_inquiry: [
    "Ask the caller's name and organization",
    "Confirm event date and location",
    "Ask expected attendance",
    "Ask package interest",
    "Capture the best callback details",
    "Agree on the next step",
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
