import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserIncomingCall, BrowserVoiceDevice } from "@/features/calls/computer-calling-types";
import { incomingCallingApi, type IncomingCallingCapability } from "@/features/calls/incoming-calling-api";
import { prepareIncomingAudio, readIncomingAudioPreferences, saveIncomingAudioPreferences } from "@/features/calls/incoming-audio";

export type IncomingAvailabilityState = "off" | "checking-media" | "registering" | "ready" | "reconnecting" | "unavailable";
const leaseHeartbeatMilliseconds = 20_000;
export function useIncomingCallAvailability(createDevice: () => BrowserVoiceDevice, capability: IncomingCallingCapability | null, onIncoming?: (call: BrowserIncomingCall) => void) {
  const [state, setState] = useState<IncomingAvailabilityState>("off");
  const [audio, setAudio] = useState<Awaited<ReturnType<typeof prepareIncomingAudio>> | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioChanging, setAudioChanging] = useState(false);
  const [testingSpeaker, setTestingSpeaker] = useState(false);
  const preferences = useRef(readIncomingAudioPreferences());
  const changing = useRef(false);
  const starting = useRef(false);
  const device = useRef<BrowserVoiceDevice | null>(null);
  const lease = useRef<{ leaseId: string; secret: string } | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const epoch = useRef(0);
  const turnOff = useCallback(async () => {
    const current = ++epoch.current;
    setAudioChanging(false); setTestingSpeaker(false);
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = null;
    const currentDevice = device.current; device.current = null;
    const currentLease = lease.current; lease.current = null;
    await currentDevice?.unregister().catch(() => undefined);
    await currentDevice?.destroy().catch(() => undefined);
    if (currentLease) await incomingCallingApi.releaseLease(currentLease.leaseId, currentLease.secret).catch(() => undefined);
    if (current === epoch.current) setState("off");
  }, []);
  const turnOn = useCallback(async (takeover = false) => {
    if (starting.current) return;
    if (!capability?.enabled) { setState("unavailable"); return; }
    starting.current = true;
    const stoppedEpoch = epoch.current + 1;
    await turnOff();
    if (epoch.current !== stoppedEpoch) { starting.current = false; return; }
    const current = ++epoch.current;
    try {
      setAudioError(null);
      setState("checking-media");
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => stream.getTracks().forEach((track) => track.stop()));
      if (current !== epoch.current) return;
      const acquired = await incomingCallingApi.acquireLease(takeover);
      if (current !== epoch.current) {
        await incomingCallingApi.releaseLease(acquired.leaseId, acquired.secret).catch(() => undefined);
        return;
      }
      lease.current = acquired;
      setState("registering");
      const next = createDevice(); device.current = next;
      const token = await incomingCallingApi.token(acquired.leaseId, acquired.secret);
      if (current !== epoch.current) return;
      await next.prepare(token.token);
      if (current !== epoch.current) { await next.destroy(); return; }
      const preparedAudio = await prepareIncomingAudio(next, preferences.current);
      if (current !== epoch.current) { await next.destroy(); return; }
      setAudio(preparedAudio);
      // Keep selected IDs only on this browser; never store labels or tokens.
      preferences.current = { inputId: preparedAudio.inputId, outputId: preparedAudio.outputId || undefined };
      saveIncomingAudioPreferences(preferences.current);
      next.on("incoming", (call) => { if (current === epoch.current) onIncoming?.(call as BrowserIncomingCall); });
      next.on("tokenWillExpire", () => {
        void incomingCallingApi.token(acquired.leaseId, acquired.secret).then((refresh) => {
          if (current === epoch.current) return next.updateToken(refresh.token);
        }).catch(() => { if (current === epoch.current) setState("unavailable"); });
      });
      next.on("unregistered", () => { if (current === epoch.current) setState("reconnecting"); });
      next.on("error", () => { if (current === epoch.current) setState("unavailable"); });
      await next.register();
      if (current !== epoch.current) { await next.unregister().catch(() => undefined); await next.destroy(); return; }
      if (current === epoch.current) {
        heartbeat.current = setInterval(() => {
          void incomingCallingApi.renewLease(acquired.leaseId, acquired.secret).catch(() => {
            if (current === epoch.current) {
              if (heartbeat.current) clearInterval(heartbeat.current);
              heartbeat.current = null; setState("unavailable");
            }
          });
        }, leaseHeartbeatMilliseconds);
        setState("ready");
      }
    } catch (error) {
      if (current === epoch.current) {
        await turnOff();
        if (epoch.current !== current + 1) return;
        setAudioError(error instanceof Error ? error.message : "Could not prepare call audio.");
        setState("unavailable");
      }
    } finally { starting.current = false; }
  }, [capability?.enabled, createDevice, onIncoming, turnOff]);

  const selectAudio = useCallback(async (kind: "input" | "output", id: string) => {
    const next = device.current, current = epoch.current;
    if (!next || state !== "ready" || changing.current) return;
    changing.current = true; setAudioChanging(true); setAudioError(null);
    try {
      if (kind === "input") await next.selectInput(id);
      else if (!await next.selectOutput(id)) throw new Error("Use computer sound settings to select your speaker.");
      if (current !== epoch.current) return;
      preferences.current = { ...preferences.current, [kind === "input" ? "inputId" : "outputId"]: id };
      saveIncomingAudioPreferences(preferences.current);
      setAudio(value => value ? { ...value, [kind === "input" ? "inputId" : "outputId"]: id, warning: "" } : value);
    } catch (error) {
      if (current === epoch.current) setAudioError(error instanceof Error ? error.message : "Could not change audio device.");
    } finally {
      changing.current = false;
      if (current === epoch.current) setAudioChanging(false);
    }
  }, [state]);
  const testSpeaker = useCallback(async () => {
    if (!device.current?.testOutput || state !== "ready") return;
    const current = epoch.current;
    setTestingSpeaker(true); setAudioError(null);
    try { await device.current.testOutput(); }
    catch { if (current === epoch.current) setAudioError("Could not play the speaker test. Check browser sound permission and speaker settings."); }
    finally { if (current === epoch.current) setTestingSpeaker(false); }
  }, [state]);
  useEffect(() => () => { void turnOff(); }, [turnOff]);
  return { state, turnOn, turnOff, device: device.current, activeLease: Boolean(lease.current), audio, audioError, audioChanging, testingSpeaker, selectAudio, testSpeaker };
}
