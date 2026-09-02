import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { TwilioBrowserDevice } from "./twilio-browser-device";
import { incomingCallingApi, type IncomingCallingCapability } from "./incoming-calling-api";
import { useIncomingCallAvailability } from "@/hooks/use-incoming-call-availability";
import { useIncomingCall } from "@/hooks/use-incoming-call";

type IncomingContextValue = { availability: ReturnType<typeof useIncomingCallAvailability>; incoming: ReturnType<typeof useIncomingCall>; capability: IncomingCallingCapability | null; reveal: () => void; dismiss: () => void; };
const Context = createContext<IncomingContextValue | null>(null);
export function IncomingCallingProvider({ children }: { children: ReactNode }) {
  const [capability, setCapability] = useState<IncomingCallingCapability | null>(null);
  const incoming = useIncomingCall();
  const availability = useIncomingCallAvailability(() => new TwilioBrowserDevice(), capability, incoming.receive);
  useEffect(() => { void incomingCallingApi.capability().then(setCapability).catch(() => setCapability({ enabled: false })); }, []);
  return <Context.Provider value={{ availability, incoming, capability, reveal: () => undefined, dismiss: () => undefined }}>{children}</Context.Provider>;
}
export function useIncomingCalling() {
  const value = useContext(Context);
  if (!value) throw new Error("IncomingCallingProvider is required.");
  return value;
}