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
  const { clearPageContext, setPageContext } = useAssistantContext();

  useEffect(() => {
    if (!recordId) return;
    const registered = { kind, recordId, label };
    setPageContext(registered);
    return () => clearPageContext(registered);
  }, [clearPageContext, kind, label, recordId, setPageContext]);

  return null;
}
