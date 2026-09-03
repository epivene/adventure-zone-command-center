import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserIncomingCall } from "@/features/calls/computer-calling-types";
import { useIncomingCall } from "./use-incoming-call";

const incomingApi = vi.hoisted(() => ({
  session: vi.fn(),
  sendToVoicemail: vi.fn(),
}));

vi.mock("@/features/calls/incoming-calling-api", () => ({
  incomingCallingApi: incomingApi,
}));

function incomingCall(sessionId: string) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const call: BrowserIncomingCall = {
    parameters: { inboundSessionId: sessionId },
    accept: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn(),
    disconnect: vi.fn(),
    mute: vi.fn(),
    sendDigits: vi.fn(),
    on: (event, listener) => listeners.set(event, listener),
  };
  return { call, emit: (event: string) => listeners.get(event)?.() };
}

describe("useIncomingCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    incomingApi.sendToVoicemail.mockResolvedValue(undefined);
    incomingApi.session.mockImplementation(async (id: string) => ({
      id,
      status: "ringing",
      caller: { displayName: "Caller", matched: false },
      startedAt: null,
      answeredAt: null,
      endedAt: null,
    }));
  });

  it("receives another call after the previous caller cancels", async () => {
    const first = incomingCall("first-session");
    const second = incomingCall("second-session");
    const { result } = renderHook(() => useIncomingCall());

    await act(async () => result.current.receive(first.call));
    expect(result.current.state).toBe("ringing");

    act(() => first.emit("cancel"));
    expect(result.current.state).toBe("ended");

    await act(async () => result.current.receive(second.call));

    expect(result.current.state).toBe("ringing");
    expect(result.current.session?.id).toBe("second-session");
  });

  it("receives another call after sending the previous call to voicemail", async () => {
    const first = incomingCall("first-session");
    const second = incomingCall("second-session");
    const { result } = renderHook(() => useIncomingCall());

    await act(async () => result.current.receive(first.call));
    await act(async () => {
      expect(await result.current.voicemail()).toBe(true);
    });
    expect(result.current.state).toBe("ended");

    await act(async () => result.current.receive(second.call));

    expect(result.current.state).toBe("ringing");
    expect(result.current.session?.id).toBe("second-session");
  });
});
