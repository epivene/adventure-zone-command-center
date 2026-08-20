import { AssistantSources } from "./assistant-sources";
import type { AssistantAnswer } from "@/features/assistant/assistant-types";

export function AssistantMessage({ answer }: { answer: AssistantAnswer }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">
          Booking Assistant
        </p>
        {answer.mode !== "cloud" ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {answer.mode === "offline_cached" ? "Offline saved data" : "Command Center data"}
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
