import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ActiveAssistantContext } from "./assistant-types";

type ConcreteAssistantContext = Exclude<ActiveAssistantContext, null>;
export type AssistantScoutLaunchPrefill = {
  anchorLabel: string;
  radiusMiles: 25 | 50 | 100 | 150 | 200 | 300;
  dateStart: string;
  dateEnd: string;
  criteriaSummary: string;
};

type AssistantContextValue = {
  pageContext: ActiveAssistantContext;
  transientContext: ActiveAssistantContext;
  explicitContext: ActiveAssistantContext;
  activeContext: ActiveAssistantContext;
  setPageContext(context: ActiveAssistantContext): void;
  clearPageContext(context: ConcreteAssistantContext): void;
  setTransientContext(context: ActiveAssistantContext): void;
  clearTransientContext(context?: ConcreteAssistantContext): void;
  selectExplicitContext(context: ConcreteAssistantContext): void;
  clearExplicitContext(): void;
  isOpen: boolean;
  prefill: string;
  scoutLaunchPrefill: AssistantScoutLaunchPrefill | null;
  openAssistant(prefill?: string, scoutLaunchPrefill?: AssistantScoutLaunchPrefill): void;
  closeAssistant(): void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

function sameRecord(left: ActiveAssistantContext, right: ActiveAssistantContext) {
  if (!left || !right) return left === right;
  return left.kind === right.kind && left.recordId === right.recordId;
}

export function AssistantContextProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContextState] = useState<ActiveAssistantContext>(null);
  const pageContextRef = useRef<ActiveAssistantContext>(null);
  const [transientContext, setTransientContextState] = useState<ActiveAssistantContext>(null);
  const [explicitContext, setExplicitContext] = useState<ActiveAssistantContext>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const [scoutLaunchPrefill, setScoutLaunchPrefill] = useState<AssistantScoutLaunchPrefill | null>(null);

  const setPageContext = useCallback((next: ActiveAssistantContext) => {
    const previous = pageContextRef.current;
    if (next && !sameRecord(previous, next)) setExplicitContext(null);
    pageContextRef.current = next;
    setPageContextState(next);
  }, []);

  const clearPageContext = useCallback((expected: ConcreteAssistantContext) => {
    if (!sameRecord(pageContextRef.current, expected)) return;
    pageContextRef.current = null;
    setPageContextState(null);
  }, []);

  const setTransientContext = useCallback((next: ActiveAssistantContext) => {
    setTransientContextState(next);
  }, []);
  const clearTransientContext = useCallback((expected?: ConcreteAssistantContext) => {
    setTransientContextState((current) => !expected || sameRecord(current, expected) ? null : current);
  }, []);
  const selectExplicitContext = useCallback((next: ConcreteAssistantContext) => setExplicitContext(next), []);
  const clearExplicitContext = useCallback(() => setExplicitContext(null), []);

  const activeContext = transientContext ?? explicitContext ?? pageContext ?? null;

  const value = useMemo<AssistantContextValue>(() => ({
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
    scoutLaunchPrefill,
    openAssistant(nextPrefill = "", nextScoutLaunchPrefill) {
      setPrefill(nextPrefill);
      setScoutLaunchPrefill(nextScoutLaunchPrefill ?? null);
      setIsOpen(true);
    },
    closeAssistant() {
      setIsOpen(false);
      setPrefill("");
      setScoutLaunchPrefill(null);
    },
  }), [activeContext, clearExplicitContext, clearPageContext, clearTransientContext, explicitContext, isOpen, pageContext, prefill, scoutLaunchPrefill, selectExplicitContext, setPageContext, setTransientContext, transientContext]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistantContext(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistantContext must be used inside AssistantContextProvider");
  return value;
}
