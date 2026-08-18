import { Bot } from "lucide-react";
import { useManagerAssistant } from "@/features/manager-assistant/manager-assistant-context";

export function ManagerAssistantLauncher() {
  const { activeContext, openAssistant } = useManagerAssistant();
  return (
    <button
      aria-label="Open Operations Assistant"
      className="fixed bottom-24 right-4 z-30 flex items-center gap-2 rounded-full bg-orange-600 px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-orange-700"
      onClick={() => openAssistant()}
      type="button"
    >
      <Bot className="h-5 w-5" />
      <span className="hidden sm:inline">Assistant</span>
      {activeContext?.label ? <span className="sr-only"> for {activeContext.label}</span> : null}
    </button>
  );
}
