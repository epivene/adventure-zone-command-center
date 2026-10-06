import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TwilioBrowserDevice } from "./twilio-browser-device";
import { incomingCallingApi, type IncomingCallingCapability } from "./incoming-calling-api";
import { createBrowserIncomingAlertEnvironment, createIncomingCallAlerts } from "./incoming-call-alerts";
import { useIncomingCallAvailability } from "@/hooks/use-incoming-call-availability";
import { useIncomingCall } from "@/hooks/use-incoming-call";

type IncomingContextValue = { availability: ReturnType<typeof useIncomingCallAvailability>; incoming: ReturnType<typeof useIncomingCall>; capability: IncomingCallingCapability | null; reveal: () => void; dismiss: () => void; enableAlerts: () => Promise<void>; testAlerts: () => Promise<void>; alertWarnings: string[]; testingAlerts: boolean; };
const Context = createContext<IncomingContextValue | null>(null);
export function IncomingCallingProvider({ children }: { children: ReactNode }) {
  const [capability, setCapability] = useState<IncomingCallingCapability | null>(null);
  const [alertWarnings, setAlertWarnings] = useState<string[]>([]);
  const [testingAlerts, setTestingAlerts] = useState(false);
  const incoming = useIncomingCall();
  const incomingState = useRef(incoming.state); incomingState.current = incoming.state;
  const alerts = useRef<ReturnType<typeof createIncomingCallAlerts> | null>(null);
  if (!alerts.current) alerts.current = createIncomingCallAlerts(createBrowserIncomingAlertEnvironment());
  const testTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const createDevice = useCallback(() => new TwilioBrowserDevice(), []);
  const availability = useIncomingCallAvailability(createDevice, capability, incoming.receive);
  const enableAlerts = useCallback(async () => {
    const warnings = await alerts.current!.prepare();
    if (mounted.current) setAlertWarnings(warnings);
  }, []);
  const testAlerts = useCallback(async () => {
    if (incomingState.current !== "idle" && incomingState.current !== "ended") return;
    setTestingAlerts(true);
    await enableAlerts();
    if (!mounted.current || (incomingState.current !== "idle" && incomingState.current !== "ended")) return;
    const warnings = alerts.current!.start("test");
    setAlertWarnings(warnings);
    if (testTimer.current) clearTimeout(testTimer.current);
    testTimer.current = setTimeout(() => {
      alerts.current?.stop(); testTimer.current = null;
      if (mounted.current) setTestingAlerts(false);
    }, 4000);
  }, [enableAlerts]);
  useEffect(() => {
    if (testTimer.current) clearTimeout(testTimer.current);
    testTimer.current = null; setTestingAlerts(false);
    if (incoming.state === "ringing") {
      const id = incoming.call?.parameters.inboundSessionId ?? incoming.call?.parameters.sessionId ?? "incoming";
      const warnings = alerts.current!.start(id);
      setAlertWarnings(warnings);
    } else alerts.current!.stop();
  }, [incoming.state, incoming.call]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (testTimer.current) clearTimeout(testTimer.current);
      alerts.current?.stop();
    };
  }, []);
  useEffect(() => { void incomingCallingApi.capability().then(setCapability).catch(() => setCapability({ enabled: false })); }, []);
  return <Context.Provider value={{ availability, incoming, capability, reveal: () => { window.focus(); document.getElementById("incoming-call-panel")?.scrollIntoView({ block: "nearest" }); }, dismiss: () => undefined, enableAlerts, testAlerts, alertWarnings, testingAlerts }}>{children}</Context.Provider>;
}
export function useIncomingCalling() {
  const value = useContext(Context);
  if (!value) throw new Error("IncomingCallingProvider is required.");
  return value;
}
