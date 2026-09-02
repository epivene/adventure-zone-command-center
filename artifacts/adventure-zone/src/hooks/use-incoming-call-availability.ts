import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserIncomingCall, BrowserVoiceDevice } from "@/features/calls/computer-calling-types";
import { incomingCallingApi, type IncomingCallingCapability } from "@/features/calls/incoming-calling-api";

export type IncomingAvailabilityState = "off" | "checking-media" | "registering" | "ready" | "reconnecting" | "unavailable";
export function useIncomingCallAvailability(createDevice: () => BrowserVoiceDevice, capability: IncomingCallingCapability | null, onIncoming?: (call: BrowserIncomingCall) => void) {
  const [state, setState] = useState<IncomingAvailabilityState>("off");
  const device = useRef<BrowserVoiceDevice | null>(null);
  const lease = useRef<{ leaseId: string; secret: string } | null>(null);
  const epoch = useRef(0);
  const turnOff = useCallback(async () => {
    const current = ++epoch.current;
    const currentDevice = device.current; device.current = null;
    const currentLease = lease.current; lease.current = null;
    await currentDevice?.unregister().catch(() => undefined);
    await currentDevice?.destroy().catch(() => undefined);
    if (currentLease) await incomingCallingApi.releaseLease(currentLease.leaseId, currentLease.secret).catch(() => undefined);
    if (current === epoch.current) setState("off");
  }, []);
  const turnOn = useCallback(async (takeover = false) => {
    if (!capability?.enabled) { setState("unavailable"); return; }
    const current = ++epoch.current;
    try {
      setState("checking-media");
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => stream.getTracks().forEach((track) => track.stop()));
      const acquired = await incomingCallingApi.acquireLease(takeover);
      if (current !== epoch.current) return;
      lease.current = acquired;
      setState("registering");
      const next = createDevice(); device.current = next;
      const token = await incomingCallingApi.token(acquired.leaseId, acquired.secret);
      if (current !== epoch.current) return;
      await next.prepare(token.token); await next.register();
      next.on("incoming", (call) => onIncoming?.(call as BrowserIncomingCall));
      next.on("tokenWillExpire", () => {
        void incomingCallingApi.token(acquired.leaseId, acquired.secret).then((refresh) => next.updateToken(refresh.token)).catch(() => setState("unavailable"));
      });
      next.on("unregistered", () => setState("reconnecting"));
      next.on("error", () => setState("unavailable"));
      if (current === epoch.current) setState("ready");
    } catch {
      if (current === epoch.current) setState("unavailable");
    }
  }, [capability?.enabled, createDevice, onIncoming]);
  useEffect(() => () => { void turnOff(); }, [turnOff]);
  return { state, turnOn, turnOff, device: device.current, activeLease: Boolean(lease.current) };
}