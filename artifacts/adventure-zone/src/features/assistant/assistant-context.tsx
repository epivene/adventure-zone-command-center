import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ActiveAssistantContext } from "./assistant-types";

type AssistantContextValue = {
  activeContext: ActiveAssistantContext;
  setActiveContext(context: ActiveAssistantContext): void;
  isOpen: boolean;
  prefill: string;
  openAssistant(prefill?: string): void;
  closeAssistant(): void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantContextProvider({ children }: { children: ReactNode }) {
  const [activeContext, setActiveContext] = useState<ActiveAssistantContext>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState("");

  const value = useMemo<AssistantContextValue>(
    () => ({
      activeContext,
      setActiveContext,
      isOpen,
      prefill,
      openAssistant(nextPrefill = "") {
        setPrefill(nextPrefill);
        setIsOpen(true);
      },
      closeAssistant() {
        setIsOpen(false);
        setPrefill("");
      },
    }),
    [activeContext, isOpen, prefill],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistantContext(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error("useAssistantContext must be used inside AssistantContextProvider");
  }
  return value;
}
