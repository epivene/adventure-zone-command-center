import { Button } from "@workspace/avz-crm/components/ui/button";
import { useIncomingCalling } from "@/features/calls/incoming-calling-context";
export function IncomingAvailabilityControl() {
  const calling = useIncomingCalling();
  const incoming = calling.availability;
  if (!calling.capability?.enabled) return null;
  const active = incoming.state !== "off" && incoming.state !== "unavailable";
  return <section className="rounded-xl border border-border bg-card p-4" aria-label="Incoming call availability">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Incoming calls</h2><p className="text-sm text-muted-foreground">{incoming.state === "ready" ? "Ready to receive calls." : `Status: ${incoming.state.replace("-", " ")}`}</p></div>
    <Button onClick={() => { if (active) void incoming.turnOff(); else { void calling.enableAlerts(); void incoming.turnOn(); } }} variant={active ? "outline" : "default"}>{active ? "Turn off" : "Be available"}</Button></div>
    <Button className="mt-3" variant="outline" disabled={calling.testingAlerts || (calling.incoming.state !== "idle" && calling.incoming.state !== "ended")} onClick={() => void calling.testAlerts()}>Test ringtone and notification</Button>
    {calling.testingAlerts ? <p className="mt-2 text-sm" role="status">Test alert: you should hear ringing and see a desktop notification.</p> : null}
    {calling.alertWarnings.map(warning => <p key={warning} className="mt-2 text-sm text-amber-700" role="alert">{warning}</p>)}
    {incoming.state === "ready" ? <p className="mt-3 text-sm">Manually forward Verizon calls with <strong>*72 + Twilio number</strong>. This is not verified by Command Center.</p> : null}
    {incoming.state === "off" ? <p className="mt-3 text-sm text-muted-foreground">If forwarding was enabled, manually dial <strong>*73</strong> to turn it off.</p> : null}
  </section>;
}