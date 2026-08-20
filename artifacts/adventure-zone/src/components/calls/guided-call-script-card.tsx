"use client";

import type { GuidedCallScriptKind } from "@/features/calls/call-types";
import {
  GUIDED_CALL_SCRIPT_KINDS,
  getGuidedCallScript,
  renderGuidedText,
  type GuidedCallRenderContext,
} from "@/features/calls/guided-call-scripts";
import type { GuidedCallState } from "@/features/calls/guided-call-state";

const labels: Record<GuidedCallScriptKind, string> = {
  first_outreach: "First outreach",
  rebooking: "Past customer / rebooking",
  follow_up: "Follow-up",
  proposal_contract: "Proposal / contract",
  callback: "Requested callback",
  incoming_inquiry: "Incoming inquiry",
};

export function GuidedCallScriptCard({
  kind,
  state,
  renderContext,
  onChooseResponse,
  onChangeKind,
}: {
  kind: GuidedCallScriptKind;
  state: GuidedCallState;
  renderContext: GuidedCallRenderContext;
  onChooseResponse: (responseId: string) => void;
  onChangeKind: (kind: GuidedCallScriptKind) => void;
}) {
  const script = getGuidedCallScript(kind);
  const node = script.nodes[state.nodeId] ?? script.nodes[script.startNodeId];

  return (
    <section
      aria-labelledby="guided-script-title"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="guided-call-script"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Live call guide</p>
          <h2 className="mt-1 text-xl font-bold" id="guided-script-title">What to say next</h2>
        </div>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Script
          <select
            aria-label="Guided call script"
            className="min-w-44"
            onChange={(event) => onChangeKind(event.target.value as GuidedCallScriptKind)}
            value={kind}
          >
            {GUIDED_CALL_SCRIPT_KINDS.map((value) => (
              <option key={value} value={value}>{labels[value]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 rounded-xl bg-slate-950 p-4 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-300">Say this</p>
        <p className="mt-2 text-lg font-semibold leading-relaxed">
          {renderGuidedText(node.say, renderContext)}
        </p>
        {node.coach ? (
          <p className="mt-3 border-t border-white/15 pt-3 text-sm text-slate-300">
            <span className="font-semibold text-white">Coach:</span> {node.coach}
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <p className="text-sm font-bold text-slate-800">What did they say?</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {node.responses.map((response) => (
            <button
              className="min-h-12 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-semibold text-slate-900 shadow-sm transition hover:border-orange-400 hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
              key={response.id}
              onClick={() => onChooseResponse(response.id)}
              type="button"
            >
              {response.label}
            </button>
          ))}
        </div>
      </div>

      {state.staged.disposition || state.staged.nextAction || state.staged.noteFragments.length ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
          <p className="font-bold">Suggested — not saved yet</p>
          <div className="mt-1 grid gap-1">
            {state.staged.disposition ? <p>Outcome: {state.staged.disposition.replaceAll("_", " ")}</p> : null}
            {state.staged.nextAction ? <p>Next action: {state.staged.nextAction.replaceAll("_", " ")}</p> : null}
            {state.staged.noteFragments.map((fragment) => <p key={fragment}>Note: {fragment}</p>)}
          </div>
        </div>
      ) : null}
    </section>
  );
}
