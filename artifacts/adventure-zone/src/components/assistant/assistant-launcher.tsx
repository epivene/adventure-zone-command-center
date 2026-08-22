import { Bot } from "lucide-react";

import { useAssistantContext } from "@/features/assistant/assistant-context";

export function AssistantLauncher({
  placement = "floating",
}: {
  placement?: "toolbar" | "floating";
}) {
  const { activeContext, openAssistant } = useAssistantContext();
  const isToolbar = placement === "toolbar";

  return (
    <button
      aria-label="Open Booking Assistant"
      className={
        isToolbar
          ? "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-orange-200 bg-orange-50 text-orange-700 transition hover:border-orange-300 hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-300"
          : "fixed bottom-20 right-4 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-orange-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-300 md:hidden"
      }
      onClick={() => openAssistant()}
      title={isToolbar ? "Booking Assistant" : undefined}
      type="button"
    >
      <Bot className={isToolbar ? "h-4.5 w-4.5" : "h-5 w-5"} />
      {!isToolbar ? <span className="hidden sm:inline">Assistant</span> : null}
      {!isToolbar && activeContext?.label ? (
        <span className="hidden max-w-40 truncate rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold sm:inline">
          {activeContext.label}
        </span>
      ) : null}
    </button>
  );
}
