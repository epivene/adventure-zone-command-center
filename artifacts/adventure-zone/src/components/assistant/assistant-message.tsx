import { AssistantSources } from "./assistant-sources";
import type { ClientAssistantAnswer } from "@/features/assistant/on-device-ai-client-types";

function modeLabel(mode: ClientAssistantAnswer["mode"]) {
  if (mode === "offline_cached") return "Offline saved data";
  if (mode === "on_device") return "On-device";
  if (mode === "deterministic") return "Command Center data";
  return null;
}

export function AssistantMessage({ answer }: { answer: ClientAssistantAnswer }) {
  const label = modeLabel(answer.mode);
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">
          Booking Assistant
        </p>
        {label ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {label}
          </span>
        ) : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-900">
        {answer.text}
      </p>
      <AssistantSources sources={answer.sources} />
    </article>
  );
}