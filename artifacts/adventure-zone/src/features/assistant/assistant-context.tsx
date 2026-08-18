import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ActiveAssistantContext } from "./assistant-types";

type ConcreteAssistantContext = Exclude<ActiveAssistantContext, null>;

type AssistantContextValue = {
  pageContext: ActiveAssistantContext;
  transientContext: ActiveAssistantContext;
  explicitContext: ActiveAssistantContext;
  activeContext: ActiveAssistantContext;
  setPageContext(context: ActiveAssistantContext): void;
  clearPageContext(context: ConcreteAssistantContext): void;
  setTransientContext(context: ActiveAssistantContext): void;
  clearTransientContext(): void;
  selectExplicitContext(context: ConcreteAssistantContext): void;
  clearExplicitContext(): void;
  isOpen: boolean;
  prefill: string;
  openAssistant(prefill?: string): void;
  closeAssistant(): void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

function sameRecord(left: ActiveAssistantContext, right: ActiveAssistantContext) {
  if (!left || !right) return left === right;
  return left.kind === right.kind && left.recordId === right.recordId;
}

export function AssistantContextProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContextState] = useState<ActiveAssistantContext>(null);
  const [transientContext, setTransientContextState] = useState<ActiveAssistantContext>(null);
  const [explicitContext, setExplicitContext] = useState<ActiveAssistantContext>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState("");

  const setPageContext = useCallback((next: ActiveAssistantContext) => {
    setPageContextState((previous) => {
      if (next && !sameRecord(previous, next)) {
        setExplicitContext(null);
      }
      return next;
    });
  }, []);

  const clearPageContext = useCallback((expected: ConcreteAssistantContext) => {
    setPageContextState((current) =>
      sameRecord(current, expected) ? null : current,
    );
  }, []);

  const setTransientContext = useCallback((next: ActiveAssistantContext) => {
    setTransientContextState(next);
  }, []);
  const clearTransientContext = useCallback(() => setTransientContextState(null), []);
  const selectExplicitContext = useCallback((next: ConcreteAssistantContext) => {
    setExplicitContext(next);
  }, []);
  const clearExplicitContext = useCallback(() => setExplicitContext(null), []);

  const activeContext = transientContext ?? explicitContext ?? pageContext ?? null;

  const value = useMemo<AssistantContextValue>(
    () => ({
      pageContext,
      transientContext,
      explicitContext,
      activeContext,
      setPageContext,
      clearPageContext,
      setTransientContext,
      clearTransientContext,
      selectExplicitContext,
      clearExplicitContext,
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
    [
      activeContext,
      clearExplicitContext,
      clearPageContext,
      clearTransientContext,
      explicitContext,
      isOpen,
      pageContext,
      prefill,
      selectExplicitContext,
      setPageContext,
      setTransientContext,
      transientContext,
    ],
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
