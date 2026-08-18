import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ManagerAssistantContextRef } from "./manager-assistant-types";

export const MANAGER_ASSISTANT_PENDING_KEY = "az_manager_assistant_pending";

type ManagerAssistantContextValue = {
  activeContext: ManagerAssistantContextRef | null;
  setActiveContext: (context: ManagerAssistantContextRef | null) => void;
  open: boolean;
  openAssistant: (prefill?: string) => void;
  closeAssistant: () => void;
  prefill: string;
};

const Context = createContext<ManagerAssistantContextValue | null>(null);

export function ManagerAssistantProvider({ children, defaultContext }: { children: ReactNode; defaultContext: ManagerAssistantContextRef | null }) {
  const [override, setOverride] = useState<ManagerAssistantContextRef | null>(null);
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const activeContext = override ?? defaultContext;
  const value = useMemo<ManagerAssistantContextValue>(() => ({
    activeContext,
    setActiveContext: setOverride,
    open,
    prefill,
    openAssistant(next = "") {
      setPrefill(next);
      setOpen(false);
      try {
        sessionStorage.setItem(MANAGER_ASSISTANT_PENDING_KEY, JSON.stringify({ context: activeContext, prefill: next }));
      } catch {}
      window.location.assign("/manager/messages?assistant=1");
    },
    closeAssistant() { setOpen(false); setPrefill(""); },
  }), [activeContext, open, prefill]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useManagerAssistant() {
  const value = useContext(Context);
  if (!value) throw new Error("useManagerAssistant must be inside ManagerAssistantProvider");
  return value;
}
