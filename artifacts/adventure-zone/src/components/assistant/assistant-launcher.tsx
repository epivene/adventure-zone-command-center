import { Bot } from "lucide-react";

import { useAssistantContext } from "@/features/assistant/assistant-context";

export function AssistantLauncher() {
  const { activeContext, openAssistant } = useAssistantContext();

  return (
    <button
      aria-label="Open Booking Assistant"
      className="fixed bottom-20 right-4 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-orange-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 md:bottom-6 md:right-6"
      onClick={() => openAssistant()}
      type="button"
    >
      <Bot className="h-5 w-5" />
      <span className="hidden sm:inline">Assistant</span>
      {activeContext?.label ? (
        <span className="hidden max-w-40 truncate rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold lg:inline">
          {activeContext.label}
        </span>
      ) : null}
    </button>
  );
}
