import { useEffect } from "react";

import { useAssistantContext } from "@/features/assistant/assistant-context";
import type { AssistantContextKind } from "@/features/assistant/assistant-types";

export function AssistantTransientContext({
  open,
  kind,
  recordId,
  label,
}: {
  open: boolean;
  kind: AssistantContextKind;
  recordId: string;
  label: string;
}) {
  const { clearTransientContext, setTransientContext } = useAssistantContext();

  useEffect(() => {
    if (!open || !recordId) return;
    const registered = { kind, recordId, label };
    setTransientContext(registered);
    return () => clearTransientContext(registered);
  }, [clearTransientContext, kind, label, open, recordId, setTransientContext]);

  return null;
}
