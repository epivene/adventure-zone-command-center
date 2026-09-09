import { useEffect, useRef, useState } from "react";
import { saveConventionDraft } from "./boss-work-request-api";
import type { ConventionNotes } from "./boss-work-request-types";

export function useConventionDraft(
  requestId: string,
  initialPayload: ConventionNotes,
  initialRevision: number,
) {
  const storageKey = `boss-convention-draft:${requestId}`;
  const local = (() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "null") as { payload: ConventionNotes; revision: number } | null; }
    catch { return null; }
  })();
  const [payload, setPayloadState] = useState<ConventionNotes>(
    local && local.revision > initialRevision ? local.payload : initialPayload,
  );
  const revision = useRef(Math.max(initialRevision, local?.revision ?? 0));
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const mounted = useRef(false);

  function setPayload(next: ConventionNotes | ((current: ConventionNotes) => ConventionNotes)) {
    setPayloadState((current) => typeof next === "function" ? next(current) : next);
    revision.current += 1;
    setSaveState("saving");
  }

  function reset() {
    revision.current += 1;
    setPayloadState({ eventName: "" });
    try { localStorage.removeItem(storageKey); } catch {}
    setSaveState("saved");
  }

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const sentRevision = revision.current;
    try { localStorage.setItem(storageKey, JSON.stringify({ payload, revision: sentRevision })); } catch {}
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const result = await saveConventionDraft(requestId, sentRevision, payload);
        if (result.draft.clientRevision === revision.current && result.accepted) {
          setSaveState("saved");
          try { localStorage.removeItem(storageKey); } catch {}
        }
      } catch {
        setSaveState("offline");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [payload, requestId, storageKey]);

  return { payload, setPayload, reset, saveState, revision: revision.current };
}
