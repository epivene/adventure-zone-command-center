import { useEffect } from "react";

import { useAssistantContext } from "@/features/assistant/assistant-context";
import type { AssistantContextKind } from "@/features/assistant/assistant-types";

export function AssistantContextRegistration({
  kind,
  recordId,
  label,
}: {
  kind: AssistantContextKind;
  recordId: string;
  label: string;
}) {
  const { setActiveContext } = useAssistantContext();

  useEffect(() => {
    if (!recordId) return;
    setActiveContext({ kind, recordId, label });
    return () => setActiveContext(null);
  }, [kind, label, recordId, setActiveContext]);

  return null;
}
