import { createContext, useContext, type ReactNode } from "react";

import type { GuidedCallScriptOverride } from "./guided-call-scripts";

const GuidedCallScriptOverridesContext = createContext<GuidedCallScriptOverride[]>([]);

export function GuidedCallScriptOverridesProvider({
  overrides,
  children,
}: {
  overrides: GuidedCallScriptOverride[];
  children: ReactNode;
}) {
  return (
    <GuidedCallScriptOverridesContext.Provider value={overrides}>
      {children}
    </GuidedCallScriptOverridesContext.Provider>
  );
}

export function useGuidedCallScriptOverrides(): GuidedCallScriptOverride[] {
  return useContext(GuidedCallScriptOverridesContext);
}
