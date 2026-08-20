import { apiDelete, apiGet, apiPut } from "@/lib/auth-token";
import type { GuidedCallScriptKind } from "./call-types";
import type { GuidedCallScriptOverride } from "./guided-call-scripts";

export type SavedGuidedCallScriptOverride = GuidedCallScriptOverride & {
  updatedAt: string;
};

export async function loadCallScriptOverrides(): Promise<SavedGuidedCallScriptOverride[]> {
  const result = await apiGet<{ overrides: SavedGuidedCallScriptOverride[] }>("/settings/call-scripts");
  return result.overrides ?? [];
}

export async function saveCallScriptOverride(input: {
  scriptKind: GuidedCallScriptKind;
  nodeId: string;
  sayText: string;
  coachText: string | null;
}): Promise<SavedGuidedCallScriptOverride> {
  const result = await apiPut<{ ok: true; record: SavedGuidedCallScriptOverride }>(
    `/settings/call-scripts/${encodeURIComponent(input.scriptKind)}/${encodeURIComponent(input.nodeId)}`,
    { sayText: input.sayText, coachText: input.coachText },
  );
  return result.record;
}

export async function resetCallScriptOverride(
  scriptKind: GuidedCallScriptKind,
  nodeId: string,
): Promise<void> {
  await apiDelete<{ ok: true }>(
    `/settings/call-scripts/${encodeURIComponent(scriptKind)}/${encodeURIComponent(nodeId)}`,
  );
}
