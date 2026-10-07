import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserIncomingCall,
  BrowserVoiceCall,
  BrowserVoiceDevice,
} from "@/features/calls/computer-calling-types";
import { useIncomingCallAvailability } from "./use-incoming-call-availability";

const incomingApi = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  renewLease: vi.fn(),
  releaseLease: vi.fn(),
  token: vi.fn(),
}));

vi.mock("@/features/calls/incoming-calling-api", () => ({
  incomingCallingApi: incomingApi,
}));

class FakeDevice implements BrowserVoiceDevice {
  readonly prepare = vi.fn().mockResolvedValue(undefined);
  readonly register = vi.fn().mockResolvedValue(undefined);
  readonly unregister = vi.fn().mockResolvedValue(undefined);
  readonly updateToken = vi.fn().mockResolvedValue(undefined);
  readonly connect =
    vi.fn<(params: { sessionId: string }) => Promise<BrowserVoiceCall>>();
  readonly listAudioDevices = vi.fn<BrowserVoiceDevice["listAudioDevices"]>().mockResolvedValue({
    inputs: [],
    outputs: [],
  });
  readonly selectInput = vi.fn().mockResolvedValue(undefined);
  readonly selectOutput = vi.fn().mockResolvedValue(false);
  readonly destroy = vi.fn().mockResolvedValue(undefined);
  readonly on =
    vi.fn<
      (
        event:
          | "registered"
          | "unregistered"
          | "tokenWillExpire"
          | "incoming"
          | "error",
        listener: (...args: unknown[]) => void,
      ) => void
    >();
}

describe("useIncomingCallAvailability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop }],
        }),
      },
    });
    incomingApi.acquireLease.mockResolvedValue({
      leaseId: "aa61c2c1-3015-433d-a209-7fcff1ca1d7d",
      secret: "lease-secret",
      clientIdentity: "inbound-browser",
      expiresAt: "2026-09-03T17:50:45.000Z",
      activeCall: false,
    });
    incomingApi.token.mockResolvedValue({
      token: "browser-token",
      expiresAt: "2026-09-03T17:55:00.000Z",
    });
    incomingApi.renewLease.mockResolvedValue({
      leaseId: "aa61c2c1-3015-433d-a209-7fcff1ca1d7d",
      secret: "lease-secret",
      clientIdentity: "",
      expiresAt: "2026-09-03T17:51:15.000Z",
      activeCall: false,
    });
    incomingApi.releaseLease.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews availability before the 45-second server lease expires", async () => {
    const device = new FakeDevice();
    const { result, unmount } = renderHook(() =>
      useIncomingCallAvailability(
        () => device,
        { enabled: true },
        vi.fn<(call: BrowserIncomingCall) => void>(),
      ),
    );

    await act(async () => {
      await result.current.turnOn();
    });
    expect(result.current.state).toBe("ready");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(44_000);
    });

    expect(incomingApi.renewLease).toHaveBeenCalledWith(
      "aa61c2c1-3015-433d-a209-7fcff1ca1d7d",
      "lease-secret",
    );
    unmount();
  });
  it("configures input and speaker before registering for incoming calls", async () => {
    const device = new FakeDevice();
    device.listAudioDevices.mockResolvedValue({
      inputs: [{deviceId:"default",label:"Microphone"} as MediaDeviceInfo],
      outputs: [{deviceId:"default",label:"Headphones"} as MediaDeviceInfo],
    });
    device.selectOutput.mockResolvedValue(true);
    const {result,unmount}=renderHook(()=>useIncomingCallAvailability(()=>device,{enabled:true}));
    await act(async()=>{await result.current.turnOn();});
    expect(device.selectInput).toHaveBeenCalledWith("default");
    expect(device.selectOutput).toHaveBeenCalledWith("default");
    expect(device.selectInput.mock.invocationCallOrder[0]).toBeLessThan(device.register.mock.invocationCallOrder[0]);
    expect(device.selectOutput.mock.invocationCallOrder[0]).toBeLessThan(device.register.mock.invocationCallOrder[0]);
    expect(result.current.audio?.inputId).toBe("default");
    expect(result.current.state).toBe("ready");
    unmount();
  });

  it("allows an available listener to change mic and releases the device when turned off", async () => {
    const device=new FakeDevice();
    const {result,unmount}=renderHook(()=>useIncomingCallAvailability(()=>device,{enabled:true}));
    await act(async()=>{await result.current.turnOn();});
    await act(async()=>{await result.current.selectAudio("input","voicemod");});
    expect(device.selectInput).toHaveBeenLastCalledWith("voicemod");
    expect(result.current.audio?.inputId).toBe("voicemod");
    await act(async()=>{await result.current.turnOff();});
    expect(device.destroy).toHaveBeenCalled();
    expect(incomingApi.releaseLease).toHaveBeenCalled();
    expect(result.current.state).toBe("off");
    unmount();
  });

  it("does not register or retain a lease when microphone setup fails", async () => {
    const device=new FakeDevice();device.selectInput.mockRejectedValue(new Error("Microphone blocked"));
    const {result,unmount}=renderHook(()=>useIncomingCallAvailability(()=>device,{enabled:true}));
    await act(async()=>{await result.current.turnOn();});
    expect(device.register).not.toHaveBeenCalled();
    expect(device.destroy).toHaveBeenCalled();
    expect(incomingApi.releaseLease).toHaveBeenCalled();
    expect(result.current.state).toBe("unavailable");
    expect(result.current.audioError).toBe("Microphone blocked");
    unmount();
  });

});
