"use client";

import { useEffect, useMemo, useState } from "react";

import type { GuidedCallScriptKind } from "@/features/calls/call-types";
import {
  GUIDED_CALL_SCRIPT_KINDS,
  getConfiguredGuidedCallScript,
  renderGuidedText,
  type GuidedCallRenderContext,
} from "@/features/calls/guided-call-scripts";
import { useGuidedCallScriptOverrides } from "@/features/calls/guided-call-script-settings-context";
import type { GuidedCallState } from "@/features/calls/guided-call-state";
import {
  detectFollowUpOpeningMode,
  followUpOpeningFor,
  followUpOpeningLabels,
  type FollowUpOpeningMode,
} from "@/features/calls/follow-up-opening";
import { naturalGuidedCallSay } from "@/features/calls/natural-guided-call-copy";

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
  lastOutcome = null,
  onChooseResponse,
  onChangeKind,
}: {
  kind: GuidedCallScriptKind;
  state: GuidedCallState;
  renderContext: GuidedCallRenderContext;
  lastOutcome?: string | null;
  onChooseResponse: (responseId: string) => void;
  onChangeKind: (kind: GuidedCallScriptKind) => void;
}) {
  const overrides = useGuidedCallScriptOverrides();
  const script = getConfiguredGuidedCallScript(kind, overrides);
  const node = script.nodes[state.nodeId] ?? script.nodes[script.startNodeId];
  const [followUpOpeningMode, setFollowUpOpeningMode] = useState<FollowUpOpeningMode>("auto");

  useEffect(() => {
    setFollowUpOpeningMode("auto");
  }, [lastOutcome]);

  const autoFollowUpMode = useMemo(() => detectFollowUpOpeningMode(lastOutcome), [lastOutcome]);
  const hasAdminOverride = overrides.some((override) => (
    override.scriptKind === kind
    && override.nodeId === node.id
    && Boolean(override.sayText?.trim())
  ));
  const isFollowUpOpening = kind === "follow_up" && node.id === script.startNodeId && !hasAdminOverride;
  const naturalSpokenText = naturalGuidedCallSay({
    kind,
    nodeId: node.id,
    fallback: node.say,
    hasAdminOverride,
  });
  const spokenText = isFollowUpOpening
    ? followUpOpeningFor({ mode: followUpOpeningMode, lastOutcome }).say
    : naturalSpokenText;

  return (
    <section
      aria-labelledby="guided-script-title"
      className="sticky top-2 z-20 rounded-2xl border border-orange-200 bg-white p-4 shadow-lg sm:static sm:z-auto sm:p-5 sm:shadow-sm"
      data-testid="guided-call-script"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Live call guide</p>
          <h2 className="mt-0.5 text-lg font-bold" id="guided-script-title">Active script</h2>
        </div>
        <label className="grid gap-1 text-[11px] font-semibold text-slate-500">
          Script
          <select
            aria-label="Guided call script"
            className="min-w-40 text-sm"
            onChange={(event) => onChangeKind(event.target.value as GuidedCallScriptKind)}
            value={kind}
          >
            {GUIDED_CALL_SCRIPT_KINDS.map((value) => (
              <option key={value} value={value}>{labels[value]}</option>
            ))}
          </select>
        </label>
      </div>

      {isFollowUpOpening ? (
        <label className="mt-3 grid gap-1 text-xs font-semibold text-slate-600 sm:max-w-sm">
          Follow-up opener
          <select
            aria-label="Follow-up opener"
            className="text-sm"
            onChange={(event) => setFollowUpOpeningMode(event.target.value as FollowUpOpeningMode)}
            value={followUpOpeningMode}
          >
            <option value="auto">Auto — {followUpOpeningLabels[autoFollowUpMode]}</option>
            <option value="generic">Generic follow-up</option>
            <option value="left_voicemail">Left voicemail last time</option>
            <option value="no_answer">No answer last time</option>
            <option value="spoke_before">We spoke before</option>
            <option value="requested_callback">They asked me to call back</option>
          </select>
        </label>
      ) : null}

      <div className="mt-3 rounded-2xl bg-slate-950 p-4 text-white sm:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-300">Say this</p>
        <p className="mt-2 text-2xl font-semibold leading-snug sm:text-3xl sm:leading-tight">
          {renderGuidedText(spokenText, renderContext)}
        </p>
      </div>

      <div className="mt-3">
        <p className="text-sm font-bold text-slate-900">What did they say?</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {node.responses.map((response) => (
            <button
              className="min-h-14 rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-left text-base font-bold text-slate-950 shadow-sm transition hover:border-orange-400 hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 active:bg-orange-100"
              key={response.id}
              onClick={() => onChooseResponse(response.id)}
              type="button"
            >
              {response.label}
            </button>
          ))}
        </div>
        <a className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-bold text-orange-800 sm:hidden" href="#call-details-title">
          Call outcome & save ↓
        </a>
      </div>

      {node.coach ? (
        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">Coaching tip</summary>
          <p className="mt-2">{node.coach}</p>
        </details>
      ) : null}

      {state.staged.disposition || state.staged.nextAction || state.staged.noteFragments.length ? (
        <details className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          <summary className="cursor-pointer font-bold">Suggested — not saved yet</summary>
          <div className="mt-2 grid gap-1">
            {state.staged.disposition ? <p>Outcome: {state.staged.disposition.replaceAll("_", " ")}</p> : null}
            {state.staged.nextAction ? <p>Next action: {state.staged.nextAction.replaceAll("_", " ")}</p> : null}
            {state.staged.noteFragments.map((fragment) => <p key={fragment}>Note: {fragment}</p>)}
          </div>
        </details>
      ) : null}
    </section>
  );
}
