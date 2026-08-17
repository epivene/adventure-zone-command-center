import { useEffect } from "react";
import { useLocation } from "wouter";

import { useAssistantContext } from "@/features/assistant/assistant-context";

const tripPath = /^\/trips\/([0-9a-f-]{36})$/i;

export function AssistantNavigationContextSync() {
  const [location] = useLocation();
  const { setActiveContext } = useAssistantContext();

  useEffect(() => {
    const match = tripPath.exec(location);
    if (!match?.[1]) return;
    setActiveContext({
      kind: "route",
      recordId: match[1],
      label: "Current route",
    });
    return () => setActiveContext(null);
  }, [location, setActiveContext]);

  return null;
}
