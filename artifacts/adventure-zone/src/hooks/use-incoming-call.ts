import { useCallback, useRef, useState } from "react";
import type { BrowserIncomingCall } from "@/features/calls/computer-calling-types";
import { incomingCallingApi, type InboundSession } from "@/features/calls/incoming-calling-api";
export type IncomingCallState = "idle" | "ringing" | "accepting" | "connected" | "sending-to-voicemail" | "ending" | "ended" | "failed";
export function useIncomingCall() {
  const [state, setState] = useState<IncomingCallState>("idle"); const [session, setSession] = useState<InboundSession | null>(null); const call = useRef<BrowserIncomingCall | null>(null); const answered = useRef(false);
  const receive = useCallback((next: BrowserIncomingCall) => {
    const id = next.parameters.inboundSessionId ?? next.parameters.sessionId;
    if (!id || call.current) return;
    call.current = next; answered.current = false; setState("ringing");
    void incomingCallingApi.session(id).then(setSession).catch(() => setState("failed"));
    const finish = (nextState: "ended" | "failed") => {
      if (call.current !== next) return;
      call.current = null;
      answered.current = false;
      setState(nextState);
    };
    next.on("disconnect", () => finish("ended")); next.on("cancel", () => finish("ended")); next.on("error", () => finish("failed"));
  }, []);
  const answer = useCallback(async () => { if (!call.current || state !== "ringing") return false; setState("accepting"); try { await call.current.accept(); answered.current = true; setState("connected"); return true; } catch { setState("failed"); return false; } }, [state]);
  const voicemail = useCallback(async () => { const id = session?.id; const currentCall = call.current; if (!currentCall || !id || answered.current || state !== "ringing") return false; setState("sending-to-voicemail"); try { await incomingCallingApi.sendToVoicemail(id); if (call.current === currentCall) call.current = null; answered.current = false; setState("ended"); return true; } catch { setState("ringing"); return false; } }, [session?.id, state]);
  const hangUp = useCallback(() => { if (!call.current || state !== "connected") return; setState("ending"); call.current.disconnect(); }, [state]);
  return { state, session, receive, answer, voicemail, hangUp, call: call.current };
}
