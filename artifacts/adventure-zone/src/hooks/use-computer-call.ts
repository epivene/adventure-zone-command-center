import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  BrowserVoiceCall,
  BrowserVoiceDevice,
  ComputerCallIntentContext,
  ComputerCallPhase,
  ComputerCallSession,
  ComputerCallStatus,
  ComputerCallingApi,
} from "@/features/calls/computer-calling-types";

export interface ComputerCallState {
  phase: ComputerCallPhase;
  sessionId: string | null;
  muted: boolean;
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  status: ComputerCallStatus | null;
  errorSummary: string | null;
  error: string | null;
  warning: string | null;
}

export interface UseComputerCallDependencies {
  api: ComputerCallingApi;
  createDevice: () => BrowserVoiceDevice;
  context: ComputerCallIntentContext;
  requestMicrophone?: () => Promise<MediaStream>;
  onPhoneLinkFallback?: (message: string) => void;
  now?: () => Date;
}

const tokenRefreshSkewMilliseconds = 30_000;

const initialState: ComputerCallState = {
  phase: "idle",
  sessionId: null,
  muted: false,
  inputs: [],
  outputs: [],
  inputDeviceId: null,
  outputDeviceId: null,
  startedAt: null,
  answeredAt: null,
  endedAt: null,
  durationSeconds: null,
  status: null,
  errorSummary: null,
  error: null,
  warning: null,
};

type Action =
  | { type: "checking" }
  | { type: "ready"; inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }
  | { type: "requesting" }
  | { type: "connecting"; sessionId: string }
  | { type: "ringing" }
  | { type: "connected"; at: string }
  | { type: "ending" }
  | { type: "completed"; at: string }
  | { type: "reconciled"; session: ComputerCallSession }
  | { type: "input"; deviceId: string }
  | { type: "output"; deviceId: string }
  | { type: "muted"; muted: boolean }
  | { type: "warning"; warning: string }
  | { type: "failed"; error: string }
  | { type: "reset" };

function reducer(state: ComputerCallState, action: Action): ComputerCallState {
  switch (action.type) {
    case "checking":
      return state.phase === "idle" || state.phase === "failed"
        ? { ...initialState, phase: "checking-devices" }
        : state;
    case "ready":
      return state.phase === "checking-devices"
        ? {
            ...state,
            phase: "ready",
            inputs: action.inputs,
            outputs: action.outputs,
            error: null,
            warning: null,
          }
        : state;
    case "requesting":
      return state.phase === "ready"
        ? { ...state, phase: "requesting-intent", error: null, warning: null }
        : state;
    case "connecting":
      return state.phase === "requesting-intent"
        ? { ...state, phase: "connecting", sessionId: action.sessionId }
        : state;
    case "ringing":
      return state.phase === "connecting"
        ? { ...state, phase: "ringing" }
        : state;
    case "connected":
      return state.phase === "connecting" || state.phase === "ringing"
        ? {
            ...state,
            phase: "connected",
            startedAt: state.startedAt ?? action.at,
            answeredAt: state.answeredAt ?? action.at,
          }
        : state;
    case "ending":
      return canEnd(state.phase) ? { ...state, phase: "ending" } : state;
    case "completed":
      return canEnd(state.phase)
        ? { ...state, phase: "completed", endedAt: state.endedAt ?? action.at }
        : state;
    case "reconciled":
      return (state.phase === "completed" || state.phase === "failed") &&
        state.sessionId === action.session.id
        ? {
            ...state,
            startedAt: action.session.startedAt ?? state.startedAt,
            answeredAt: action.session.answeredAt ?? state.answeredAt,
            endedAt: action.session.endedAt ?? state.endedAt,
            durationSeconds:
              action.session.durationSeconds ?? state.durationSeconds,
            status: action.session.status,
            errorSummary: action.session.errorSummary,
          }
        : state;
    case "input":
      return selectable(state.phase)
        ? { ...state, inputDeviceId: action.deviceId, warning: null }
        : state;
    case "output":
      return selectable(state.phase)
        ? { ...state, outputDeviceId: action.deviceId, warning: null }
        : state;
    case "muted":
      return state.phase === "connected"
        ? { ...state, muted: action.muted }
        : state;
    case "warning":
      return state.phase === "idle"
        ? state
        : { ...state, warning: action.warning };
    case "failed":
      return canFail(state.phase)
        ? { ...state, phase: "failed", error: action.error }
        : state;
    case "reset":
      return initialState;
  }
}

function canEnd(phase: ComputerCallPhase): boolean {
  return (
    phase === "connecting" ||
    phase === "ringing" ||
    phase === "connected" ||
    phase === "ending"
  );
}

function canFail(phase: ComputerCallPhase): boolean {
  return (
    phase === "checking-devices" ||
    phase === "ready" ||
    phase === "requesting-intent" ||
    phase === "connecting" ||
    phase === "ringing" ||
    phase === "connected" ||
    phase === "ending"
  );
}

function selectable(phase: ComputerCallPhase): boolean {
  return phase === "ready" || phase === "connected";
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function defaultMicrophoneRequest(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia)
    return Promise.reject(
      new Error("Microphone access is not supported by this browser."),
    );
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

function release(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function expiresSoon(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return true;
  const milliseconds = Date.parse(expiresAt);
  return (
    !Number.isFinite(milliseconds) ||
    milliseconds <= now.getTime() + tokenRefreshSkewMilliseconds
  );
}

function expired(expiresAt: string, now: Date): boolean {
  const milliseconds = Date.parse(expiresAt);
  return !Number.isFinite(milliseconds) || milliseconds <= now.getTime();
}

function isBrowserVoiceDevice(value: unknown): value is BrowserVoiceDevice {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return [
    "prepare",
    "connect",
    "listAudioDevices",
    "selectInput",
    "selectOutput",
    "destroy",
  ].every((method) => typeof candidate[method] === "function");
}

export function useComputerCall(dependencies: UseComputerCallDependencies) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const callRef = useRef<BrowserVoiceCall | null>(null);
  const deviceRef = useRef<BrowserVoiceDevice | null>(null);
  const ownedDevicesRef = useRef(new Set<BrowserVoiceDevice>());
  const sessionIdRef = useRef<string | null>(null);
  const reconciledSessionIdRef = useRef<string | null>(null);
  const tokenExpiresAtRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const terminalRef = useRef(false);
  const dialingRef = useRef(false);
  const selectionEpochRef = useRef(0);
  const now = dependencies.now ?? (() => new Date());
  stateRef.current = state;

  const isCurrent = useCallback(
    (generation: number) =>
      mountedRef.current && generationRef.current === generation,
    [],
  );
  const invalidateSelections = useCallback(() => {
    selectionEpochRef.current += 1;
  }, []);
  const invalidate = useCallback(() => {
    generationRef.current += 1;
    invalidateSelections();
    terminalRef.current = true;
    dialingRef.current = false;
    sessionIdRef.current = null;
    tokenExpiresAtRef.current = null;
    reconciledSessionIdRef.current = null;
  }, [invalidateSelections]);
  const fail = useCallback(
    (error: string) => {
      invalidateSelections();
      dispatch({ type: "failed", error });
      dependencies.onPhoneLinkFallback?.(error);
    },
    [dependencies.onPhoneLinkFallback, invalidateSelections],
  );

  const reconcile = useCallback(
    async (generation: number, sessionId: string) => {
      if (reconciledSessionIdRef.current === sessionId) return;
      reconciledSessionIdRef.current = sessionId;
      try {
        const session = await dependencies.api.getSession(sessionId);
        if (!isCurrent(generation)) return;
        dispatch({ type: "reconciled", session });
      } catch {
        if (!isCurrent(generation)) return;
        dispatch({
          type: "warning",
          warning: "Call details could not be refreshed.",
        });
      }
    },
    [dependencies.api, isCurrent],
  );

  const finish = useCallback(
    (generation: number, device: BrowserVoiceDevice, failedError?: string) => {
      if (!isCurrent(generation) || terminalRef.current) return;
      terminalRef.current = true;
      invalidateSelections();
      dialingRef.current = false;
      const sessionId = sessionIdRef.current;
      callRef.current = null;
      if (failedError) fail(failedError);
      else dispatch({ type: "completed", at: now().toISOString() });
      void device.destroy();
      if (sessionId) void reconcile(generation, sessionId);
    },
    [fail, invalidateSelections, isCurrent, now, reconcile],
  );

  const prepareFreshToken = useCallback(
    async (
      generation: number,
      device: BrowserVoiceDevice,
    ): Promise<boolean> => {
      const token = await dependencies.api.requestToken();
      if (!isCurrent(generation)) return false;
      if (expiresSoon(token.expiresAt, now()))
        throw new Error("The browser calling token has expired.");
      await device.prepare(token.token);
      if (!isCurrent(generation)) {
        await device.destroy();
        return false;
      }
      const devices = await device.listAudioDevices();
      if (!isCurrent(generation)) {
        await device.destroy();
        return false;
      }
      if (!devices.inputs.length)
        throw new Error("No microphone is available.");
      tokenExpiresAtRef.current = token.expiresAt;
      dispatch({ type: "ready", ...devices });
      return true;
    },
    [dependencies.api, isCurrent, now],
  );

  const setup = useCallback(async () => {
    if (
      stateRef.current.phase !== "idle" &&
      stateRef.current.phase !== "failed"
    )
      return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    terminalRef.current = false;
    invalidateSelections();
    dispatch({ type: "checking" });
    let device: BrowserVoiceDevice | null = null;
    try {
      const candidate = dependencies.createDevice();
      if (
        !isBrowserVoiceDevice(candidate) ||
        ownedDevicesRef.current.has(candidate)
      ) {
        throw new Error("A fresh browser voice device is required.");
      }
      device = candidate;
      ownedDevicesRef.current.add(device);
      deviceRef.current = device;
      const microphone = await (
        dependencies.requestMicrophone ?? defaultMicrophoneRequest
      )();
      if (!isCurrent(generation)) {
        release(microphone);
        await device.destroy();
        return;
      }
      release(microphone);
      await prepareFreshToken(generation, device);
    } catch (error) {
      if (!device) {
        fail("A fresh browser voice device is required.");
        return;
      }
      if (!isCurrent(generation)) {
        await device.destroy();
        return;
      }
      const denied =
        error instanceof DOMException && error.name === "NotAllowedError";
      fail(
        denied
          ? "Microphone access was denied."
          : message(error, "Computer calling could not be prepared."),
      );
      await device.destroy();
    }
  }, [
    dependencies.createDevice,
    dependencies.requestMicrophone,
    fail,
    invalidateSelections,
    isCurrent,
    prepareFreshToken,
  ]);

  const callNow = useCallback(async () => {
    if (stateRef.current.phase !== "ready" || dialingRef.current) return;
    const generation = generationRef.current;
    const device = deviceRef.current;
    if (!device) {
      fail("A fresh browser voice device is required.");
      return;
    }
    invalidateSelections();
    dialingRef.current = true;
    try {
      if (expiresSoon(tokenExpiresAtRef.current, now())) {
        if (
          !(await prepareFreshToken(generation, device)) ||
          !isCurrent(generation)
        )
          return;
      }
      if (!isCurrent(generation)) return;
      dispatch({ type: "requesting" });
      const intent = await dependencies.api.createIntent(dependencies.context);
      if (!isCurrent(generation)) return;
      if (expired(intent.expiresAt, now())) {
        throw new Error("The call intent has expired.");
      }
      sessionIdRef.current = intent.sessionId;
      reconciledSessionIdRef.current = null;
      terminalRef.current = false;
      dispatch({ type: "connecting", sessionId: intent.sessionId });
      const call = await device.connect({
        sessionId: intent.sessionId,
      });
      if (!isCurrent(generation)) {
        call.disconnect();
        await device.destroy();
        return;
      }
      callRef.current = call;
      dialingRef.current = false;
      call.on(
        "ringing",
        () => isCurrent(generation) && dispatch({ type: "ringing" }),
      );
      call.on(
        "accept",
        () =>
          isCurrent(generation) &&
          dispatch({ type: "connected", at: now().toISOString() }),
      );
      call.on("disconnect", () => finish(generation, device));
      call.on("cancel", () => finish(generation, device));
      call.on("error", (error) =>
        finish(generation, device, message(error, "The call failed.")),
      );
    } catch (error) {
      if (!isCurrent(generation)) return;
      terminalRef.current = true;
      dialingRef.current = false;
      fail(message(error, "The call could not be started."));
      await device.destroy();
    }
  }, [
    dependencies.api,
    dependencies.context,
    fail,
    finish,
    invalidateSelections,
    isCurrent,
    now,
    prepareFreshToken,
  ]);

  const mute = useCallback((value: boolean) => {
    if (stateRef.current.phase !== "connected" || !callRef.current) return;
    callRef.current.mute(value);
    dispatch({ type: "muted", muted: value });
  }, []);

  const sendDigits = useCallback((value: string): boolean => {
    if (
      stateRef.current.phase !== "connected" ||
      !callRef.current ||
      !/^[0-9*#]+$/.test(value)
    )
      return false;
    callRef.current.sendDigits(value);
    return true;
  }, []);

  const hangUp = useCallback(() => {
    if (!canEnd(stateRef.current.phase)) return;
    if (!callRef.current) {
      invalidate();
      void deviceRef.current?.destroy();
      dispatch({ type: "reset" });
      return;
    }
    invalidateSelections();
    dispatch({ type: "ending" });
    callRef.current.disconnect();
  }, [invalidate, invalidateSelections]);

  const selectInput = useCallback(
    async (deviceId: string) => {
      if (!selectable(stateRef.current.phase)) return;
      const generation = generationRef.current;
      const selectionEpoch = selectionEpochRef.current;
      const device = deviceRef.current;
      if (!device) return;
      try {
        await device.selectInput(deviceId);
        if (
          !isCurrent(generation) ||
          selectionEpochRef.current !== selectionEpoch ||
          !selectable(stateRef.current.phase)
        )
          return;
        dispatch({ type: "input", deviceId });
      } catch (error) {
        if (
          !isCurrent(generation) ||
          selectionEpochRef.current !== selectionEpoch ||
          !selectable(stateRef.current.phase)
        )
          return;
        if (stateRef.current.phase === "connected") {
          finish(
            generation,
            device,
            message(error, "Microphone selection failed."),
          );
          return;
        }
        terminalRef.current = true;
        fail(message(error, "Microphone selection failed."));
        await device.destroy();
      }
    },
    [fail, finish, isCurrent],
  );

  const selectOutput = useCallback(
    async (deviceId: string) => {
      if (!selectable(stateRef.current.phase)) return;
      const generation = generationRef.current;
      const selectionEpoch = selectionEpochRef.current;
      const device = deviceRef.current;
      if (!device) return;
      try {
        if (!(await device.selectOutput(deviceId))) {
          if (
            isCurrent(generation) &&
            selectionEpochRef.current === selectionEpoch &&
            selectable(stateRef.current.phase)
          )
            dispatch({
              type: "warning",
              warning: "Speaker selection is not supported by this browser.",
            });
          return;
        }
        if (
          !isCurrent(generation) ||
          selectionEpochRef.current !== selectionEpoch ||
          !selectable(stateRef.current.phase)
        )
          return;
        dispatch({ type: "output", deviceId });
      } catch (error) {
        if (
          !isCurrent(generation) ||
          selectionEpochRef.current !== selectionEpoch ||
          !selectable(stateRef.current.phase)
        )
          return;
        if (stateRef.current.phase === "connected") {
          finish(
            generation,
            device,
            message(error, "Speaker selection failed."),
          );
          return;
        }
        terminalRef.current = true;
        fail(message(error, "Speaker selection failed."));
        await device.destroy();
      }
    },
    [fail, finish, isCurrent],
  );

  const reset = useCallback(() => {
    if (canEnd(stateRef.current.phase) && callRef.current) return;
    invalidate();
    callRef.current?.disconnect();
    callRef.current = null;
    void deviceRef.current?.destroy();
    dispatch({ type: "reset" });
  }, [invalidate]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      invalidate();
      callRef.current?.disconnect();
      callRef.current = null;
      void deviceRef.current?.destroy();
    },
    [invalidate],
  );

  return {
    state,
    setup,
    callNow,
    mute,
    sendDigits,
    hangUp,
    selectInput,
    selectOutput,
    reset,
  };
}
