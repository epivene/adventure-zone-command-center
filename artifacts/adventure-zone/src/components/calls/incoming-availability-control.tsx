import { Button } from "@workspace/avz-crm/components/ui/button";
import { useIncomingCalling } from "@/features/calls/incoming-calling-context";
export function IncomingAvailabilityControl() {
  const calling = useIncomingCalling();
  const incoming = calling.availability;
  if (!calling.capability?.enabled) return null;
  const active = incoming.activeLease || (incoming.state !== "off" && incoming.state !== "unavailable");
  return <section className="rounded-xl border border-border bg-card p-4" aria-label="Incoming call availability">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Incoming calls</h2><p className="text-sm text-muted-foreground">{incoming.state === "ready" ? "Ready to receive calls." : `Status: ${incoming.state.replace("-", " ")}`}</p></div>
    <Button onClick={() => { if (active) void incoming.turnOff(); else { void calling.enableAlerts(); void incoming.turnOn(); } }} variant={active ? "outline" : "default"}>{active ? "Turn off" : "Be available"}</Button></div>
    {incoming.audio ? <div className="mt-4 grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Microphone
          <select aria-label="Incoming call microphone" value={incoming.audio.inputId} disabled={incoming.state !== "ready" || incoming.audioChanging} onChange={event => void incoming.selectAudio("input", event.target.value)}>
            {incoming.audio.inputs.length ? incoming.audio.inputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || ("Microphone " + (index + 1))}</option>) : <option value="default">System default microphone</option>}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">Speaker / headphones
          <select aria-label="Incoming call speaker" value={incoming.audio.outputId} disabled={incoming.state !== "ready" || incoming.audioChanging || !incoming.audio.outputSupported} onChange={event => void incoming.selectAudio("output", event.target.value)}>
            {!incoming.audio.outputSupported ? <option value="">System speaker</option> : incoming.audio.outputs.length ? incoming.audio.outputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || ("Speaker " + (index + 1))}</option>) : <option value="default">System default speaker</option>}
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">For Voicemod, choose its virtual microphone here. Choose your real headphones or speakers for hearing callers. These choices are remembered on this computer.</p>
      {incoming.state === "ready" ? <p className="text-xs text-muted-foreground">Your selected microphone stays active while Available. Audio is sent to a caller only after you answer. Turn off releases the microphone.</p> : null}
      <Button variant="outline" disabled={incoming.state !== "ready" || incoming.testingSpeaker || incoming.audioChanging || !incoming.audio.outputSupported || (calling.incoming.state !== "idle" && calling.incoming.state !== "ended")} onClick={() => void incoming.testSpeaker()}>{incoming.testingSpeaker ? "Playing speaker test…" : "Test call speaker"}</Button>
      {incoming.audio.warning ? <p className="text-sm text-amber-700" role="status">{incoming.audio.warning}</p> : null}
    </div> : null}
    {incoming.audioError ? <p className="mt-3 text-sm text-amber-700" role="alert">{incoming.audioError}</p> : null}
    <Button className="mt-3" variant="outline" disabled={calling.testingAlerts || (calling.incoming.state !== "idle" && calling.incoming.state !== "ended")} onClick={() => void calling.testAlerts()}>Test ringtone and notification</Button>
    {calling.testingAlerts ? <p className="mt-2 text-sm" role="status">Test alert: you should hear ringing and see a desktop notification.</p> : null}
    {calling.alertWarnings.map(warning => <p key={warning} className="mt-2 text-sm text-amber-700" role="alert">{warning}</p>)}
    {incoming.state === "ready" ? <p className="mt-3 text-sm">Manually forward Verizon calls with <strong>*72 + Twilio number</strong>. This is not verified by Command Center.</p> : null}
    {incoming.state === "off" ? <p className="mt-3 text-sm text-muted-foreground">If forwarding was enabled, manually dial <strong>*73</strong> to turn it off.</p> : null}
  </section>;
}