import { useLocation } from "wouter";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { useIncomingCalling } from "@/features/calls/incoming-calling-context";
export function IncomingCallPanel() {
  const calling = useIncomingCalling(); const incoming = calling.incoming; const [, navigate] = useLocation();
  if (incoming.state === "idle" || incoming.state === "ended") return null;
  return <aside id="incoming-call-panel" aria-live="assertive" className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-primary/30 bg-card p-5 shadow-lg">
    <p className="text-sm font-bold uppercase tracking-wide text-primary">Incoming call</p><h2 className="mt-1 text-xl font-bold">{incoming.session?.caller.displayName ?? "Incoming Adventure Zone call"}</h2><p className="mt-1 text-sm text-muted-foreground">{incoming.session?.caller.matched ? "Matched profile" : "Unknown caller — link only after review."}</p>
    {incoming.state === "ringing" ? <div className="mt-4 flex gap-2"><Button onClick={() => void incoming.answer().then((accepted) => { if (accepted && incoming.session) navigate(`/calls/workspace?inboundSessionId=${encodeURIComponent(incoming.session.id)}`); })}>Answer</Button><Button onClick={() => void incoming.voicemail()} variant="outline">Send to voicemail</Button></div> : null}
    {incoming.state === "connected" ? <Button className="mt-4" onClick={incoming.hangUp} variant="destructive">Hang up</Button> : null}
  </aside>;
}