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
  const { pageContext, setPageContext } = useAssistantContext();

  useEffect(() => {
    if (!recordId) return;
    const registered = { kind, recordId, label };
    setPageContext(registered);
    return () => {
      if (
        pageContext?.kind === registered.kind &&
        pageContext.recordId === registered.recordId
      ) {
        setPageContext(null);
      }
    };
  }, [kind, label, pageContext, recordId, setPageContext]);

  return null;
}
