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
  private readonly handlers = new Map<string, (...args: unknown[]) => void>();
  readonly prepare = vi.fn().mockResolvedValue(undefined);
  readonly register = vi.fn().mockResolvedValue(undefined);
  readonly unregister = vi.fn().mockResolvedValue(undefined);
  readonly updateToken = vi.fn().mockResolvedValue(undefined);
  readonly connect =
    vi.fn<(params: { sessionId: string }) => Promise<BrowserVoiceCall>>();
  readonly listAudioDevices = vi.fn().mockResolvedValue({
    inputs: [],
    outputs: [],
  });
  readonly selectInput = vi.fn().mockResolvedValue(undefined);
  readonly selectOutput = vi.fn().mockResolvedValue(false);
  readonly destroy = vi.fn().mockResolvedValue(undefined);
  readonly on = vi.fn(
    (
      event:
        | "registered"
        | "unregistered"
        | "tokenWillExpire"
        | "incoming"
        | "error",
      listener: (...args: unknown[]) => void,
    ) => {
      this.handlers.set(event, listener);
    },
  );

  emit(event: "error"): void {
    this.handlers.get(event)?.();
  }
}

describe("useIncomingCallAvailability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
  it("recovers its own active lease when availability is turned on again", async () => {
    let serverLeaseActive = false;
    incomingApi.acquireLease.mockImplementation(async () => {
      if (serverLeaseActive) throw new Error("lease_unavailable");
      serverLeaseActive = true;
      return {
        leaseId: "aa61c2c1-3015-433d-a209-7fcff1ca1d7d",
        secret: "lease-secret",
        clientIdentity: "inbound-browser",
        expiresAt: "2026-09-03T17:50:45.000Z",
        activeCall: false,
      };
    });
    incomingApi.releaseLease.mockImplementation(async () => {
      serverLeaseActive = false;
    });
    const firstDevice = new FakeDevice();
    const secondDevice = new FakeDevice();
    const createDevice = vi
      .fn()
      .mockReturnValueOnce(firstDevice)
      .mockReturnValueOnce(secondDevice);
    const { result } = renderHook(() =>
      useIncomingCallAvailability(createDevice, { enabled: true }),
    );

    await act(async () => {
      await result.current.turnOn();
    });
    act(() => {
      firstDevice.emit("error");
    });
    expect(result.current.state).toBe("unavailable");
    expect(result.current.activeLease).toBe(true);

    await act(async () => {
      await result.current.turnOn();
    });

    expect(result.current.state).toBe("ready");
    expect(secondDevice.register).toHaveBeenCalledOnce();

    await act(async () => {
      await result.current.turnOff();
    });
  });

});
