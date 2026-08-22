import type { CallDisposition } from "@/features/calls/call-types";
import type {
  GuidedCallScript,
  GuidedCallSuggestion,
} from "@/features/calls/guided-call-scripts";

export type GuidedCallState = {
  scriptKind: GuidedCallScript["kind"];
  nodeId: string;
  path: string[];
  staged: {
    disposition: CallDisposition | null;
    nextAction: string | null;
    followUpPreset: GuidedCallSuggestion["followUpPreset"] | null;
    noteFragments: string[];
    collect: NonNullable<GuidedCallSuggestion["collect"]>;
  };
};

export function normalizeGuidedNextAction(value: string | null | undefined) {
  if (!value) return null;
  const aliases: Record<string, string> = {
    send_info: "send_information",
    send_mini_zone_info: "send_information",
    send_insurance_safety_info: "send_information",
    send_proposal: "prepare_quote",
    resend_proposal: "prepare_quote",
    research: "send_information",
    future_season: "call",
    owner_follow_up: "call",
  };
  return aliases[value] ?? value;
}

export function createGuidedCallState(script: GuidedCallScript): GuidedCallState {
  return {
    scriptKind: script.kind,
    nodeId: script.startNodeId,
    path: [script.startNodeId],
    staged: {
      disposition: null,
      nextAction: null,
      followUpPreset: null,
      noteFragments: [],
      collect: [],
    },
  };
}

function mergeUnique<T>(left: T[], right: T[] = []) {
  return [...new Set([...left, ...right])];
}

export function chooseGuidedResponse(
  script: GuidedCallScript,
  state: GuidedCallState,
  responseId: string,
): GuidedCallState {
  const node = script.nodes[state.nodeId];
  if (!node) return state;
  const response = node.responses.find((candidate) => candidate.id === responseId);
  if (!response) return state;
  const suggestion = response.suggestion;
  const nextNodeId = response.nextNodeId ?? state.nodeId;
  return {
    ...state,
    nodeId: nextNodeId,
    path: response.terminal ? state.path : [...state.path, nextNodeId],
    staged: {
      disposition: suggestion?.disposition ?? state.staged.disposition,
      nextAction:
        normalizeGuidedNextAction(suggestion?.nextAction) ?? state.staged.nextAction,
      followUpPreset: suggestion?.followUpPreset ?? state.staged.followUpPreset,
      noteFragments: mergeUnique(
        state.staged.noteFragments,
        suggestion?.noteFragment ? [suggestion.noteFragment] : [],
      ),
      collect: mergeUnique(state.staged.collect, suggestion?.collect),
    },
  };
}

export function resetGuidedCallState(script: GuidedCallScript): GuidedCallState {
  return createGuidedCallState(script);
}
