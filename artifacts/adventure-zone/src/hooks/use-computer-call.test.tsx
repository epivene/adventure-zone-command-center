import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserVoiceCall,
  BrowserVoiceDevice,
  ComputerCallingApi,
  ComputerCallSession,
} from "@/features/calls/computer-calling-types";
import {
  ComputerCallingApiError,
  computerCallingApi,
} from "@/features/calls/computer-calling-api";
import { TwilioBrowserDevice } from "@/features/calls/twilio-browser-device";
import { useComputerCall } from "./use-computer-call";

const apiFetch = vi.hoisted(() => vi.fn());
const twilioSdk = vi.hoisted(() => ({ Device: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiFetch }));
vi.mock("@twilio/voice-sdk", () => twilioSdk);

type VoiceEvent = "ringing" | "accept" | "disconnect" | "cancel" | "error";

class FakeCall implements BrowserVoiceCall {
  private readonly listeners = new Map<
    VoiceEvent,
    Array<(...args: unknown[]) => void>
  >();
  readonly mute = vi.fn<(value: boolean) => void>();
  readonly sendDigits = vi.fn<(value: string) => void>();
  readonly disconnect = vi.fn<() => void>();

  on(event: VoiceEvent, listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  emit(event: VoiceEvent, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

class FakeDevice implements BrowserVoiceDevice {
  readonly prepare = vi
    .fn<(token: string) => Promise<void>>()
    .mockResolvedValue();
  readonly connect =
    vi.fn<(params: { sessionId: string }) => Promise<BrowserVoiceCall>>();
  readonly listAudioDevices =
    vi.fn<
      () => Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>
    >();
  readonly selectInput = vi
    .fn<(deviceId: string) => Promise<void>>()
    .mockResolvedValue();
  readonly selectOutput = vi
    .fn<(deviceId: string) => Promise<boolean>>()
    .mockResolvedValue(true);
  readonly destroy = vi.fn<() => Promise<void>>().mockResolvedValue();
}

const input = {
  deviceId: "microphone-one",
  kind: "audioinput",
  label: "Mic",
  groupId: "group",
} as MediaDeviceInfo;
const output = {
  deviceId: "speaker-one",
  kind: "audiooutput",
  label: "Speaker",
  groupId: "group",
} as MediaDeviceInfo;

const session = (
  overrides: Partial<ComputerCallSession> = {},
): ComputerCallSession => ({
  id: "1a88fb87-81be-4fcb-bc50-f238de592028",
  status: "completed",
  startedAt: "2026-09-02T10:00:00.000Z",
  answeredAt: "2026-09-02T10:00:03.000Z",
  endedAt: "2026-09-02T10:01:03.000Z",
  durationSeconds: 60,
  errorSummary: null,
  ...overrides,
});

function createApi(): ComputerCallingApi & {
  requestToken: ReturnType<typeof vi.fn>;
  createIntent: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
} {
  return {
    requestToken: vi.fn().mockResolvedValue({
      token: "short-lived-token",
      expiresAt: "2026-09-02T10:05:00.000Z",
    }),
    createIntent: vi.fn().mockResolvedValue({
      sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028",
      expiresAt: "2026-09-02T10:02:00.000Z",
    }),
    getSession: vi.fn().mockResolvedValue(session()),
  };
}

function createDependencies(overrides: Record<string, unknown> = {}) {
  const device =
    (overrides.device as FakeDevice | undefined) ?? new FakeDevice();
  const call = new FakeCall();
  if (!overrides.device) {
    device.connect.mockResolvedValue(call);
    device.listAudioDevices.mockResolvedValue({
      inputs: [input],
      outputs: [output],
    });
  }
  const api = createApi();
  const stream = {
    getTracks: vi.fn(() => [{ stop: vi.fn() }]),
  } as unknown as MediaStream;
  const requestMicrophone = vi
    .fn<() => Promise<MediaStream>>()
    .mockResolvedValue(stream);
  const onPhoneLinkFallback = vi.fn<(message: string) => void>();
  const createDevice = vi.fn(() => device);

  return {
    api,
    call,
    device,
    stream,
    requestMicrophone,
    onPhoneLinkFallback,
    deps: {
      api,
      createDevice,
      context: {
        organizationId: "1a88fb87-81be-4fcb-bc50-f238de592001",
        contactId: "1a88fb87-81be-4fcb-bc50-f238de592002",
        phoneId: "1a88fb87-81be-4fcb-bc50-f238de592003",
      },
      requestMicrophone,
      onPhoneLinkFallback,
      now: () => new Date("2026-09-02T10:00:00.000Z"),
      ...overrides,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("useComputerCall", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not request microphone access before explicit setup", () => {
    const { deps, requestMicrophone } = createDependencies();
    renderHook(() => useComputerCall(deps));
    expect(requestMicrophone).not.toHaveBeenCalled();
  });

  it("fails before microphone access when the device factory is absent", async () => {
    const { deps, api, requestMicrophone } = createDependencies();
    const { createDevice: _createDevice, ...withoutFactory } = deps;
    const { result } = renderHook(() =>
      useComputerCall(
        withoutFactory as unknown as Parameters<typeof useComputerCall>[0],
      ),
    );

    await act(() => result.current.setup());

    expect(result.current.state).toMatchObject({
      phase: "failed",
      error: "A fresh browser voice device is required.",
    });
    expect(requestMicrophone).not.toHaveBeenCalled();
    expect(api.requestToken).not.toHaveBeenCalled();
  });

  it("rejects a factory that reuses a destroyed device after reset", async () => {
    const { deps, device } = createDependencies();
    deps.createDevice = vi.fn(() => device);
    const { result } = renderHook(() => useComputerCall(deps));

    await act(() => result.current.setup());
    act(() => result.current.reset());
    await act(() => result.current.setup());

    expect(result.current.state).toMatchObject({
      phase: "failed",
      error: "A fresh browser voice device is required.",
    });
    expect(device.prepare).toHaveBeenCalledOnce();
  });

  it("rejects an unexpected technical session shape from the authenticated API", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify(
          session({
            status: "not-a-provider-status" as ComputerCallSession["status"],
          }),
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      computerCallingApi.getSession("1a88fb87-81be-4fcb-bc50-f238de592028"),
    ).rejects.toEqual(
      new ComputerCallingApiError(
        "The computer calling service returned an unexpected response.",
        502,
      ),
    );
  });

  it("rejects a malformed browser token response", async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ token: "", expiresAt: "not-a-date" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(computerCallingApi.requestToken()).rejects.toEqual(
      new ComputerCallingApiError(
        "The computer calling service returned an unexpected response.",
        502,
      ),
    );
  });

  it.each([
    ["calling_suppressed", "This number is marked Do Not Call. Choose another approved number or use Phone Link."],
    ["phone_invalid", "This phone number cannot be called from the workspace. Verify the number or use Phone Link."],
    ["rate_limited", "Computer calling is temporarily busy. Wait a moment, then try again or use Phone Link."],
    ["configuration_incomplete", "Computer calling is not configured. Use Phone Link or contact an administrator."],
  ])("translates %s into a plain-language recovery message", async (code, expected) => {
    apiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: code }), { status: 400, headers: { "Content-Type": "application/json" } }),
    );

    await expect(computerCallingApi.requestToken()).rejects.toEqual(
      new ComputerCallingApiError(expected, 400),
    );
  });

  it.each([
    [new Response(null, { status: 500 }), "a missing error body"],
    [new Response(JSON.stringify({ error: "provider exploded" }), { status: 500 }), "an unrecognized error"],
  ])("uses generic recovery guidance for %s", async (response) => {
    apiFetch.mockResolvedValueOnce(response);

    await expect(computerCallingApi.requestToken()).rejects.toEqual(
      new ComputerCallingApiError(
        "Computer calling could not be completed. Try again or use Phone Link.",
        500,
      ),
    );
  });

  it("rejects an intent response with a non-UUID session ID", async () => {
    apiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId: "not-an-opaque-session-id",
          expiresAt: "2026-09-02T10:02:00.000Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      computerCallingApi.createIntent({
        organizationId: "1a88fb87-81be-4fcb-bc50-f238de592001",
        contactId: "1a88fb87-81be-4fcb-bc50-f238de592002",
        phoneId: "1a88fb87-81be-4fcb-bc50-f238de592003",
      }),
    ).rejects.toEqual(
      new ComputerCallingApiError(
        "The computer calling service returned an unexpected response.",
        502,
      ),
    );
  });

  it("does not dial during device setup", async () => {
    const { deps, device, requestMicrophone, stream } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));

    await act(() => result.current.setup());

    expect(result.current.state.phase).toBe("ready");
    expect(requestMicrophone).toHaveBeenCalledOnce();
    expect(stream.getTracks).toHaveBeenCalledOnce();
    expect(device.connect).not.toHaveBeenCalled();
  });

  it("waits for microphone permission before constructing the browser voice device", async () => {
    const microphone = deferred<MediaStream>();
    const events: string[] = [];
    const requestMicrophone = vi.fn(async () => {
      events.push("permission-requested");
      const stream = await microphone.promise;
      events.push("permission-granted");
      return stream;
    });
    const { deps, device, stream } = createDependencies({
      requestMicrophone,
    });
    deps.createDevice = vi.fn(() => {
      events.push("device-constructed");
      return device;
    });
    const { result } = renderHook(() => useComputerCall(deps));

    act(() => void result.current.setup());
    await waitFor(() => expect(requestMicrophone).toHaveBeenCalledOnce());

    expect(deps.createDevice).not.toHaveBeenCalled();

    await act(async () => microphone.resolve(stream));
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));

    expect(events).toEqual([
      "permission-requested",
      "permission-granted",
      "device-constructed",
    ]);
    expect(stream.getTracks).toHaveBeenCalledOnce();
  });

  it("moves to failed with Phone Link fallback when microphone permission is denied", async () => {
    const { deps, onPhoneLinkFallback } = createDependencies({
      requestMicrophone: vi
        .fn()
        .mockRejectedValue(new DOMException("denied", "NotAllowedError")),
    });
    const { result } = renderHook(() => useComputerCall(deps));

    await act(() => result.current.setup());

    expect(result.current.state).toMatchObject({
      phase: "failed",
      error: "Microphone access was denied.",
    });
    expect(onPhoneLinkFallback).toHaveBeenCalledWith(
      "Microphone access was denied.",
    );
  });

  it("moves to failed when no microphone is available", async () => {
    const { deps } = createDependencies({
      device: Object.assign(new FakeDevice(), {
        listAudioDevices: vi
          .fn()
          .mockResolvedValue({ inputs: [], outputs: [output] }),
      }),
    });
    const { result } = renderHook(() => useComputerCall(deps));

    await act(() => result.current.setup());

    expect(result.current.state).toMatchObject({
      phase: "failed",
      error: "No microphone is available.",
    });
  });

  it("destroys a partially prepared device when device discovery finds no microphone", async () => {
    const device = new FakeDevice();
    device.listAudioDevices.mockResolvedValue({
      inputs: [],
      outputs: [output],
    });
    const { deps } = createDependencies({ device });
    const { result } = renderHook(() => useComputerCall(deps));

    await act(() => result.current.setup());

    expect(device.destroy).toHaveBeenCalledOnce();
  });

  it("does not continue setup after unmount while microphone permission is pending", async () => {
    const microphone = deferred<MediaStream>();
    const { deps, api, device } = createDependencies({
      requestMicrophone: vi.fn().mockReturnValue(microphone.promise),
    });
    const { result, unmount } = renderHook(() => useComputerCall(deps));

    act(() => void result.current.setup());
    unmount();
    await act(async () =>
      microphone.resolve({
        getTracks: vi.fn(() => []),
      } as unknown as MediaStream),
    );

    expect(api.requestToken).not.toHaveBeenCalled();
    expect(device.prepare).not.toHaveBeenCalled();
  });

  it("does not connect after unmount while intent creation is pending", async () => {
    const intent = deferred<{ sessionId: string; expiresAt: string }>();
    const { deps, api, device } = createDependencies();
    api.createIntent.mockReturnValueOnce(intent.promise);
    const { result, unmount } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    act(() => void result.current.callNow());
    unmount();
    await act(async () =>
      intent.resolve({
        sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028",
        expiresAt: "2026-09-02T10:02:00.000Z",
      }),
    );

    expect(device.connect).not.toHaveBeenCalled();
  });

  it("invalidates a pending intent when reset returns the controller to idle", async () => {
    const intent = deferred<{ sessionId: string; expiresAt: string }>();
    const { deps, api, device } = createDependencies();
    api.createIntent.mockReturnValueOnce(intent.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    act(() => void result.current.callNow());
    act(() => result.current.reset());
    await act(async () =>
      intent.resolve({
        sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028",
        expiresAt: "2026-09-02T10:02:00.000Z",
      }),
    );

    expect(result.current.state.phase).toBe("idle");
    expect(device.connect).not.toHaveBeenCalled();
  });

  it("creates an opaque intent only after explicit callNow and sends only its session ID to Twilio", async () => {
    const { deps, api, device } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    await act(() => result.current.callNow());

    expect(api.createIntent).toHaveBeenCalledWith({
      organizationId: "1a88fb87-81be-4fcb-bc50-f238de592001",
      contactId: "1a88fb87-81be-4fcb-bc50-f238de592002",
      phoneId: "1a88fb87-81be-4fcb-bc50-f238de592003",
    });
    expect(device.connect).toHaveBeenCalledWith({
      sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028",
    });
    expect(result.current.state).toMatchObject({
      phase: "connecting",
      sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028",
    });
  });

  it("accepts exactly one call attempt while a near-expiry token refresh is pending", async () => {
    let currentTime = new Date("2026-09-02T10:00:00.000Z");
    const freshToken = deferred<{ token: string; expiresAt: string }>();
    const { deps, api } = createDependencies({ now: () => currentTime });
    api.requestToken
      .mockResolvedValueOnce({ token: "initial-token", expiresAt: "2026-09-02T10:00:31.000Z" })
      .mockReturnValueOnce(freshToken.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    currentTime = new Date("2026-09-02T10:00:02.000Z");

    const first = result.current.callNow();
    const second = result.current.callNow();

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(api.createIntent).not.toHaveBeenCalled();
    await act(async () => freshToken.resolve({ token: "refreshed-token", expiresAt: "2026-09-02T10:05:00.000Z" }));
    await first;

    expect(api.createIntent).toHaveBeenCalledTimes(1);
    expect(api.createIntent).toHaveBeenCalledWith(deps.context);
  });

  it("does not connect with an intent that is already expired", async () => {
    const { deps, api, device } = createDependencies();
    api.createIntent.mockResolvedValueOnce({
      sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028",
      expiresAt: "2026-09-02T09:59:59.000Z",
    });
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    await act(() => result.current.callNow());

    expect(result.current.state).toMatchObject({
      phase: "failed",
      error: "The call intent has expired.",
    });
    expect(device.connect).not.toHaveBeenCalled();
  });

  it("moves through ringing, connected, and completed on call events", async () => {
    const { deps, call } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("ringing"));
    expect(result.current.state.phase).toBe("ringing");
    act(() => call.emit("accept"));
    expect(result.current.state.phase).toBe("connected");
    act(() => call.emit("disconnect"));
    await waitFor(() => expect(result.current.state.phase).toBe("completed"));
  });

  it("keeps ending when late ringing and accept events arrive out of order", async () => {
    const { deps, call } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => result.current.hangUp());
    act(() => call.emit("ringing"));
    act(() => call.emit("accept"));

    expect(result.current.state.phase).toBe("ending");
  });

  it("uses the technical session once to reconcile authoritative timestamps after disconnect", async () => {
    const { deps, call, api } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("disconnect"));
    await waitFor(() =>
      expect(result.current.state.endedAt).toBe("2026-09-02T10:01:03.000Z"),
    );

    expect(api.getSession).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({
      startedAt: "2026-09-02T10:00:00.000Z",
      answeredAt: "2026-09-02T10:00:03.000Z",
      endedAt: "2026-09-02T10:01:03.000Z",
      durationSeconds: 60,
      reconciled: true,
    });
  });

  it("polls provider status until an authoritative terminal session replaces local completion details", async () => {
    const delay = vi.fn<() => Promise<void>>().mockResolvedValue();
    const { deps, api, call } = createDependencies({ reconciliationDelay: delay });
    api.getSession
      .mockResolvedValueOnce(session({ status: "in-progress", endedAt: null, durationSeconds: null }))
      .mockResolvedValueOnce(session({ status: "ringing", endedAt: null, durationSeconds: null }))
      .mockResolvedValueOnce(session({
        status: "completed",
        startedAt: "2026-09-02T10:00:01.000Z",
        answeredAt: "2026-09-02T10:00:04.000Z",
        endedAt: "2026-09-02T10:01:05.000Z",
        durationSeconds: 61,
      }));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("disconnect"));

    await waitFor(() => expect(result.current.state.reconciled).toBe(true));
    expect(api.getSession).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({
      startedAt: "2026-09-02T10:00:01.000Z",
      answeredAt: "2026-09-02T10:00:04.000Z",
      endedAt: "2026-09-02T10:01:05.000Z",
      durationSeconds: 61,
      status: "completed",
    });
  });

  it("keeps outcomes unreconciled when provider retries never supply terminal timing", async () => {
    const delay = vi.fn<() => Promise<void>>().mockResolvedValue();
    const { deps, api, call } = createDependencies({ reconciliationDelay: delay });
    api.getSession.mockResolvedValue(session({
      status: "in-progress",
      startedAt: null,
      answeredAt: null,
      endedAt: null,
      durationSeconds: null,
    }));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("disconnect"));

    await waitFor(() => expect(result.current.state.warning).toMatch(/still updating/i));
    expect(api.getSession).toHaveBeenCalledTimes(3);
    expect(result.current.state.reconciled).toBe(false);
    expect(result.current.state.status).toBeNull();
  });

  it("keeps local completion data and a nonblocking warning when reconciliation fails", async () => {
    const { deps, call, api } = createDependencies({
      reconciliationDelay: vi.fn<() => Promise<void>>().mockResolvedValue(),
    });
    api.getSession.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("disconnect"));
    await waitFor(() =>
      expect(result.current.state.warning).toBe(
        "Call details are still updating. Refresh technical details or use Phone Link.",
      ),
    );

    expect(result.current.state.phase).toBe("completed");
    expect(result.current.state.reconciled).toBe(false);
    expect(result.current.state.endedAt).toBe("2026-09-02T10:00:00.000Z");
  });

  it("reconciles a rejected browser connect after the technical session was issued", async () => {
    const delay = vi.fn<() => Promise<void>>().mockResolvedValue();
    const { deps, api, device } = createDependencies({ reconciliationDelay: delay });
    device.connect.mockRejectedValueOnce(new Error("browser transport rejected"));
    api.getSession
      .mockResolvedValueOnce(session({ status: "in-progress", endedAt: null, durationSeconds: null }))
      .mockResolvedValueOnce(session({ status: "ringing", endedAt: null, durationSeconds: null }))
      .mockResolvedValueOnce(session({ status: "busy", endedAt: "2026-09-02T10:01:00.000Z", durationSeconds: 60 }));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    await waitFor(() => expect(result.current.state.reconciled).toBe(true));
    expect(result.current.state).toMatchObject({
      phase: "failed",
      sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028",
      status: "busy",
      endedAt: "2026-09-02T10:01:00.000Z",
    });
    expect(api.getSession).toHaveBeenCalledTimes(3);
  });

  it("keeps a rejected connect session refreshable without overlapping retries or stale reconciliation", async () => {
    const delay = vi.fn<() => Promise<void>>().mockResolvedValue();
    const { deps, api, device } = createDependencies({ reconciliationDelay: delay });
    device.connect.mockRejectedValueOnce(new Error("browser transport rejected"));
    api.getSession.mockResolvedValue(session({ status: "in-progress", endedAt: null, durationSeconds: null }));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    await waitFor(() => expect(result.current.state.warning).toMatch(/still updating/i));
    expect(api.getSession).toHaveBeenCalledTimes(3);
    act(() => result.current.refresh());
    act(() => result.current.refresh());
    await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(6));
    expect(result.current.state.reconciled).toBe(false);
    act(() => result.current.reset());
    expect(result.current.state.phase).toBe("idle");
  });

  it("ignores an in-flight rejected-connect reconciliation after reset", async () => {
    const pendingSession = deferred<ComputerCallSession>();
    const { deps, api, device } = createDependencies();
    device.connect.mockRejectedValueOnce(new Error("browser transport rejected"));
    api.getSession.mockReturnValueOnce(pendingSession.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());
    await waitFor(() => expect(api.getSession).toHaveBeenCalledOnce());

    act(() => result.current.reset());
    await act(async () => pendingSession.resolve(session()));

    expect(result.current.state).toMatchObject({ phase: "idle", sessionId: null, reconciled: false });
  });

  it("fails safely on provider errors and can retry after reset", async () => {
    const deviceB = new FakeDevice();
    deviceB.listAudioDevices.mockResolvedValue({
      inputs: [input],
      outputs: [output],
    });
    const { deps, call, device } = createDependencies({
      createDevice: vi.fn(),
    });
    deps.createDevice.mockReturnValueOnce(device).mockReturnValueOnce(deviceB);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("error", new Error("network lost")));
    expect(result.current.state).toMatchObject({
      phase: "failed",
      error: "network lost",
    });
    act(() => result.current.reset());
    expect(result.current.state.phase).toBe("idle");
    await act(() => result.current.setup());
    expect(result.current.state.phase).toBe("ready");
  });

  it("reconciles a provider error once even when a disconnect follows", async () => {
    const { deps, call, api } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("error", new Error("network lost")));
    act(() => call.emit("disconnect"));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        phase: "failed",
        status: "completed",
        errorSummary: null,
      }),
    );
    expect(api.getSession).toHaveBeenCalledTimes(1);
  });

  it("cleans up the prepared device when connecting fails", async () => {
    const { deps, device } = createDependencies();
    device.connect.mockRejectedValueOnce(new Error("network lost"));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    await act(() => result.current.callNow());

    expect(result.current.state).toMatchObject({
      phase: "failed",
      error: "network lost",
    });
    expect(device.destroy).toHaveBeenCalledOnce();
  });

  it("mutes and sends only valid DTMF digits while connected", async () => {
    const { deps, call } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));

    act(() => result.current.mute(true));
    expect(result.current.state.muted).toBe(true);
    expect(call.mute).toHaveBeenCalledWith(true);
    expect(result.current.sendDigits("12#*")).toBe(true);
    expect(call.sendDigits).toHaveBeenCalledWith("12#*");
    expect(result.current.sendDigits("1a2")).toBe(false);
    expect(call.sendDigits).toHaveBeenCalledTimes(1);
  });

  it("allows transient input and supported output selection", async () => {
    const { deps, device } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    await act(() => result.current.selectInput("microphone-one"));
    await act(() => result.current.selectOutput("speaker-one"));

    expect(device.selectInput).toHaveBeenCalledWith("microphone-one");
    expect(device.selectOutput).toHaveBeenCalledWith("speaker-one");
    expect(result.current.state).toMatchObject({
      inputDeviceId: "microphone-one",
      outputDeviceId: "speaker-one",
    });
  });

  it("keeps calling available when browser speaker switching is unsupported", async () => {
    const { deps } = createDependencies({
      device: Object.assign(new FakeDevice(), {
        listAudioDevices: vi
          .fn()
          .mockResolvedValue({ inputs: [input], outputs: [output] }),
        selectOutput: vi.fn().mockResolvedValue(false),
      }),
    });
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    await act(() => result.current.selectOutput("speaker-one"));

    expect(result.current.state).toMatchObject({
      phase: "ready",
      warning: "Speaker selection is not supported by this browser.",
    });
  });

  it("fails safely and releases the device when microphone selection is rejected", async () => {
    const { deps, device } = createDependencies();
    device.selectInput.mockRejectedValueOnce(new Error("device unavailable"));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    await act(() => result.current.selectInput("microphone-one"));

    expect(result.current.state).toMatchObject({
      phase: "failed",
      error: "device unavailable",
    });
    expect(device.destroy).toHaveBeenCalledOnce();
  });

  it("reconciles once when a connected input selection is rejected", async () => {
    const { deps, api, call, device } = createDependencies();
    device.selectInput.mockRejectedValueOnce(new Error("input lost"));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));

    await act(() => result.current.selectInput("microphone-one"));
    act(() => call.emit("disconnect"));
    act(() => call.emit("error", new Error("late provider error")));

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        phase: "failed",
        error: "input lost",
        status: "completed",
        endedAt: "2026-09-02T10:01:03.000Z",
        errorSummary: null,
      }),
    );
    expect(device.destroy).toHaveBeenCalledOnce();
    expect(api.getSession).toHaveBeenCalledTimes(1);
  });

  it("reconciles once when a connected output selection is rejected", async () => {
    const { deps, api, call, device } = createDependencies();
    device.selectOutput.mockRejectedValueOnce(new Error("speaker lost"));
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));

    await act(() => result.current.selectOutput("speaker-one"));
    act(() => call.emit("error", new Error("late provider error")));
    act(() => call.emit("disconnect"));

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        phase: "failed",
        error: "speaker lost",
        status: "completed",
        endedAt: "2026-09-02T10:01:03.000Z",
        errorSummary: null,
      }),
    );
    expect(device.destroy).toHaveBeenCalledOnce();
    expect(api.getSession).toHaveBeenCalledTimes(1);
  });

  it("ignores delayed device selection results after dialing begins", async () => {
    const inputSelection = deferred<void>();
    const outputSelection = deferred<boolean>();
    const { deps, device, onPhoneLinkFallback } = createDependencies();
    device.selectInput.mockReturnValueOnce(inputSelection.promise);
    device.selectOutput.mockReturnValueOnce(outputSelection.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    act(() => void result.current.selectInput("microphone-one"));
    act(() => void result.current.selectOutput("speaker-one"));
    await act(() => result.current.callNow());
    await act(async () => {
      inputSelection.resolve();
      outputSelection.resolve(false);
    });

    expect(result.current.state).toMatchObject({
      phase: "connecting",
      inputDeviceId: null,
      outputDeviceId: null,
      warning: null,
    });
    expect(onPhoneLinkFallback).not.toHaveBeenCalled();
  });

  it("ignores a ready-phase input selection that succeeds after the call connects", async () => {
    const inputSelection = deferred<void>();
    const { deps, call, device, onPhoneLinkFallback } = createDependencies();
    device.selectInput.mockReturnValueOnce(inputSelection.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    act(() => void result.current.selectInput("microphone-one"));
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));
    await act(async () => inputSelection.resolve());

    expect(result.current.state).toMatchObject({
      phase: "connected",
      inputDeviceId: null,
      error: null,
      warning: null,
    });
    expect(device.destroy).not.toHaveBeenCalled();
    expect(onPhoneLinkFallback).not.toHaveBeenCalled();
  });

  it("ignores a ready-phase output selection that succeeds after the call connects", async () => {
    const outputSelection = deferred<boolean>();
    const { deps, call, device, onPhoneLinkFallback } = createDependencies();
    device.selectOutput.mockReturnValueOnce(outputSelection.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    act(() => void result.current.selectOutput("speaker-one"));
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));
    await act(async () => outputSelection.resolve(true));

    expect(result.current.state).toMatchObject({
      phase: "connected",
      outputDeviceId: null,
      error: null,
      warning: null,
    });
    expect(device.destroy).not.toHaveBeenCalled();
    expect(onPhoneLinkFallback).not.toHaveBeenCalled();
  });

  it("ignores a ready-phase output selection rejection after the call connects", async () => {
    const outputSelection = deferred<boolean>();
    const { deps, call, device, onPhoneLinkFallback } = createDependencies();
    device.selectOutput.mockReturnValueOnce(outputSelection.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    act(() => void result.current.selectOutput("speaker-one"));
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));
    await act(async () => outputSelection.reject(new Error("speaker lost")));

    expect(result.current.state).toMatchObject({
      phase: "connected",
      outputDeviceId: null,
      error: null,
      warning: null,
    });
    expect(device.destroy).not.toHaveBeenCalled();
    expect(onPhoneLinkFallback).not.toHaveBeenCalled();
  });

  it("ignores a ready-phase unsupported output result after the call connects", async () => {
    const outputSelection = deferred<boolean>();
    const { deps, call, device, onPhoneLinkFallback } = createDependencies();
    device.selectOutput.mockReturnValueOnce(outputSelection.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    act(() => void result.current.selectOutput("speaker-one"));
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));
    await act(async () => outputSelection.resolve(false));

    expect(result.current.state).toMatchObject({
      phase: "connected",
      outputDeviceId: null,
      error: null,
      warning: null,
    });
    expect(device.destroy).not.toHaveBeenCalled();
    expect(onPhoneLinkFallback).not.toHaveBeenCalled();
  });

  it("allows a selection initiated while connected", async () => {
    const { deps, call, device } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));

    await act(() => result.current.selectInput("microphone-one"));
    await act(() => result.current.selectOutput("speaker-one"));

    expect(device.selectInput).toHaveBeenCalledWith("microphone-one");
    expect(device.selectOutput).toHaveBeenCalledWith("speaker-one");
    expect(result.current.state).toMatchObject({
      phase: "connected",
      inputDeviceId: "microphone-one",
      outputDeviceId: "speaker-one",
    });
  });

  it("ignores a delayed output selection rejection after the call completes", async () => {
    const outputSelection = deferred<boolean>();
    const { deps, call, device, onPhoneLinkFallback } = createDependencies();
    device.selectOutput.mockReturnValueOnce(outputSelection.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());
    act(() => call.emit("accept"));
    act(() => void result.current.selectOutput("speaker-one"));
    act(() => call.emit("disconnect"));

    await act(async () => outputSelection.reject(new Error("speaker lost")));

    await waitFor(() => expect(result.current.state.phase).toBe("completed"));
    expect(result.current.state.error).toBeNull();
    expect(onPhoneLinkFallback).not.toHaveBeenCalled();
  });

  it("prevents a second callNow while an intent is pending or a call is active", async () => {
    let resolveIntent!: (value: {
      sessionId: string;
      expiresAt: string;
    }) => void;
    const pendingIntent = new Promise<{ sessionId: string; expiresAt: string }>(
      (resolve) => {
        resolveIntent = resolve;
      },
    );
    const { deps, api } = createDependencies();
    api.createIntent.mockReturnValueOnce(pendingIntent);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());

    act(() => {
      void result.current.callNow();
    });
    act(() => {
      void result.current.callNow();
    });
    expect(api.createIntent).toHaveBeenCalledTimes(1);

    await act(async () =>
      resolveIntent({
        sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028",
        expiresAt: "2026-09-02T10:02:00.000Z",
      }),
    );
    await act(() => result.current.callNow());
    expect(api.createIntent).toHaveBeenCalledTimes(1);
  });

  it("refreshes an expired browser token before creating an intent", async () => {
    let now = new Date("2026-09-02T10:00:00.000Z");
    const { deps, api, device } = createDependencies({ now: () => now });
    api.requestToken
      .mockResolvedValueOnce({
        token: "old-token",
        expiresAt: "2026-09-02T10:00:40.000Z",
      })
      .mockResolvedValueOnce({
        token: "fresh-token",
        expiresAt: "2026-09-02T10:10:00.000Z",
      });
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    now = new Date("2026-09-02T10:00:20.000Z");

    await act(() => result.current.callNow());

    expect(api.requestToken).toHaveBeenCalledTimes(2);
    expect(device.prepare).toHaveBeenLastCalledWith("fresh-token");
  });

  it("disconnects a call that resolves after unmount instead of retaining it", async () => {
    const connection = deferred<BrowserVoiceCall>();
    const { deps, device } = createDependencies();
    device.connect.mockReturnValueOnce(connection.promise);
    const { result, unmount } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    act(() => void result.current.callNow());
    await waitFor(() => expect(device.connect).toHaveBeenCalledOnce());

    unmount();
    const lateCall = new FakeCall();
    await act(async () => connection.resolve(lateCall));

    await waitFor(() => expect(lateCall.disconnect).toHaveBeenCalledOnce());
  });

  it("cancels a pending connection when hangUp occurs before a call object exists", async () => {
    const connection = deferred<BrowserVoiceCall>();
    const { deps, device } = createDependencies();
    device.connect.mockReturnValueOnce(connection.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    act(() => void result.current.callNow());
    await waitFor(() => expect(device.connect).toHaveBeenCalledOnce());

    act(() => result.current.hangUp());
    const lateCall = new FakeCall();
    await act(async () => connection.resolve(lateCall));

    expect(result.current.state.phase).toBe("idle");
    await waitFor(() => expect(lateCall.disconnect).toHaveBeenCalledOnce());
  });

  it("cancels a pending connection when reset occurs before a call object exists", async () => {
    const connection = deferred<BrowserVoiceCall>();
    const { deps, device } = createDependencies();
    device.connect.mockReturnValueOnce(connection.promise);
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    act(() => void result.current.callNow());
    await waitFor(() => expect(device.connect).toHaveBeenCalledOnce());

    act(() => result.current.reset());
    const lateCall = new FakeCall();
    await act(async () => connection.resolve(lateCall));

    expect(result.current.state.phase).toBe("idle");
    await waitFor(() => expect(lateCall.disconnect).toHaveBeenCalledOnce());
  });

  it("keeps a newer setup device ready when a stale setup finishes", async () => {
    const pendingPrepare = deferred<void>();
    const deviceA = new FakeDevice();
    deviceA.prepare.mockReturnValueOnce(pendingPrepare.promise);
    const deviceB = new FakeDevice();
    deviceB.listAudioDevices.mockResolvedValue({
      inputs: [input],
      outputs: [output],
    });
    const devices = [deviceA, deviceB];
    const { deps, api } = createDependencies({
      device: deviceA,
      createDevice: vi.fn(() => devices.shift()!),
    });
    const { result } = renderHook(() => useComputerCall(deps));

    act(() => void result.current.setup());
    await waitFor(() => expect(deviceA.prepare).toHaveBeenCalledOnce());
    act(() => result.current.reset());
    await act(() => result.current.setup());
    expect(result.current.state.phase).toBe("ready");

    await act(async () => pendingPrepare.resolve());

    expect(result.current.state.phase).toBe("ready");
    expect(deviceB.destroy).not.toHaveBeenCalled();
    expect(api.requestToken).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer setup device ready when a stale setup rejects", async () => {
    const pendingPrepare = deferred<void>();
    const deviceA = new FakeDevice();
    deviceA.prepare.mockReturnValueOnce(pendingPrepare.promise);
    const deviceB = new FakeDevice();
    deviceB.listAudioDevices.mockResolvedValue({
      inputs: [input],
      outputs: [output],
    });
    const devices = [deviceA, deviceB];
    const { deps } = createDependencies({
      device: deviceA,
      createDevice: vi.fn(() => devices.shift()!),
    });
    const { result } = renderHook(() => useComputerCall(deps));

    act(() => void result.current.setup());
    await waitFor(() => expect(deviceA.prepare).toHaveBeenCalledOnce());
    act(() => result.current.reset());
    await act(() => result.current.setup());
    expect(result.current.state.phase).toBe("ready");

    await act(async () =>
      pendingPrepare.reject(new Error("stale device failed")),
    );

    expect(result.current.state.phase).toBe("ready");
    expect(deviceB.destroy).not.toHaveBeenCalled();
  });

  it("hangs up an active call and moves to ending until disconnect", async () => {
    const { deps, call } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => result.current.hangUp());
    expect(call.disconnect).toHaveBeenCalledOnce();
    expect(result.current.state.phase).toBe("ending");
  });

  it("settles an error after hangup into failed and reconciles once", async () => {
    const { deps, call, api } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => result.current.hangUp());
    act(() => call.emit("error", new Error("transport closed")));
    act(() => call.emit("disconnect"));

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        phase: "failed",
        status: "completed",
      }),
    );
    expect(api.getSession).toHaveBeenCalledTimes(1);
  });

  it("treats a cancelled call as a terminal session that is reconciled once", async () => {
    const { deps, call, api } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("cancel"));

    await waitFor(() => expect(result.current.state.phase).toBe("completed"));
    expect(api.getSession).toHaveBeenCalledTimes(1);
  });

  it("releases the browser voice device after a call ends", async () => {
    const { deps, call, device } = createDependencies();
    const { result } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    act(() => call.emit("disconnect"));

    await waitFor(() => expect(device.destroy).toHaveBeenCalledOnce());
  });

  it("disconnects and destroys the device during unmount cleanup", async () => {
    const { deps, call, device } = createDependencies();
    const { result, unmount } = renderHook(() => useComputerCall(deps));
    await act(() => result.current.setup());
    await act(() => result.current.callNow());

    unmount();
    await waitFor(() => expect(device.destroy).toHaveBeenCalledOnce());
    expect(call.disconnect).toHaveBeenCalledOnce();
  });
});

describe("TwilioBrowserDevice", () => {
  it("removes call listeners and destroys Twilio resources during teardown", async () => {
    const rawCall = {
      mute: vi.fn(),
      sendDigits: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    const rawDevice = {
      connect: vi.fn().mockResolvedValue(rawCall),
      destroy: vi.fn(),
      audio: {
        availableInputDevices: new Map(),
        availableOutputDevices: new Map(),
        isOutputSelectionSupported: true,
        setInputDevice: vi.fn(),
        speakerDevices: { set: vi.fn().mockResolvedValue(undefined) },
        ringtoneDevices: { set: vi.fn().mockResolvedValue(undefined) },
      },
    };
    twilioSdk.Device.mockImplementation(function () {
      return rawDevice;
    });
    const device = new TwilioBrowserDevice();

    await device.prepare("ephemeral-browser-token");
    await device.connect({ sessionId: "1a88fb87-81be-4fcb-bc50-f238de592028" });
    await device.destroy();

    expect(rawCall.removeAllListeners).toHaveBeenCalledOnce();
    expect(rawCall.disconnect).toHaveBeenCalledOnce();
    expect(rawDevice.destroy).toHaveBeenCalledOnce();
  });
});
