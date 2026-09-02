"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ContactPhoneRecord } from "@/features/contact-phones/contact-phone-types";
import { computerCallingApi } from "@/features/calls/computer-calling-api";
import { TwilioBrowserDevice } from "@/features/calls/twilio-browser-device";
import { useComputerCall } from "@/hooks/use-computer-call";

export type ComputerCallTerminal = {
  sessionId: string;
  phoneId: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string;
  durationSeconds: number | null;
  status: string | null;
  errorSummary: string | null;
};

type ComputerCallPanelProps = {
  organizationId: string;
  contact: { id: string; name: string };
  phone: ContactPhoneRecord;
  callerIdDisplay: string;
  onTerminal?: (call: ComputerCallTerminal) => void;
  onPhaseChange?: (active: boolean) => void;
  onLivePhaseChange?: (active: boolean) => void;
  onTechnicalPendingChange?: (pending: boolean) => void;
  onReset?: () => void;
  onClose?: () => void;
};

function phaseLabel(phase: ReturnType<typeof useComputerCall>["state"]["phase"]) {
  return {
    idle: "Ready to set up",
    "checking-devices": "Checking microphone",
    ready: "Ready to call",
    "requesting-intent": "Preparing secure call",
    connecting: "Connecting",
    ringing: "Ringing",
    connected: "Connected",
    ending: "Ending",
    completed: "Completed",
    failed: "Failed",
  }[phase];
}

function elapsed(startedAt: string | null, endedAt: string | null, now: number) {
  if (!startedAt) return "00:00";
  const end = endedAt ? Date.parse(endedAt) : now;
  const seconds = Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function duration(seconds: number | null, startedAt: string | null, endedAt: string | null, now: number) {
  if (seconds !== null) return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return elapsed(startedAt, endedAt, now);
}

function technicalStatus(status: ReturnType<typeof useComputerCall>["state"]["status"]) {
  if (!status) return null;
  return {
    created: "Created",
    queued: "Queued",
    ringing: "Ringing",
    "in-progress": "In progress",
    completed: "Completed",
    busy: "Busy",
    "no-answer": "No answer",
    canceled: "Canceled",
    failed: "Failed",
    unknown: "Unknown",
  }[status];
}

export function ComputerCallPanel({
  organizationId,
  contact,
  phone,
  callerIdDisplay,
  onTerminal,
  onPhaseChange,
  onLivePhaseChange,
  onTechnicalPendingChange,
  onReset,
  onClose,
}: ComputerCallPanelProps) {
  const context = useMemo(() => ({ organizationId, contactId: contact.id, phoneId: phone.id }), [organizationId, contact.id, phone.id]);
  const createDevice = useCallback(() => new TwilioBrowserDevice(), []);
  const computerCall = useComputerCall({ api: computerCallingApi, context, createDevice });
  const { state } = computerCall;
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emittedSessionRef = useRef<string | null>(null);
  const attemptPhoneIdRef = useRef<string | null>(null);
  const [attemptPending, setAttemptPending] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (
      (state.phase === "completed" || state.phase === "failed") &&
      state.reconciled && state.sessionId && state.startedAt && state.endedAt &&
      emittedSessionRef.current !== state.sessionId && onTerminal
    ) {
      emittedSessionRef.current = state.sessionId;
      onTerminal({
        sessionId: state.sessionId,
        phoneId: attemptPhoneIdRef.current ?? phone.id,
        startedAt: state.startedAt,
        answeredAt: state.answeredAt,
        endedAt: state.endedAt,
        durationSeconds: state.durationSeconds,
        status: state.status,
        errorSummary: state.errorSummary,
      });
    }
  }, [onTerminal, phone.id, state.answeredAt, state.durationSeconds, state.endedAt, state.errorSummary, state.phase, state.reconciled, state.sessionId, state.startedAt, state.status]);

  useEffect(() => {
    if (state.phase !== "connected" || !state.startedAt || state.endedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state.endedAt, state.phase, state.startedAt]);

  const active = state.phase === "connecting" || state.phase === "ringing" || state.phase === "connected" || state.phase === "ending";
  const live = state.phase === "requesting-intent" || active;
  const terminal = state.phase === "completed" || state.phase === "failed";
  const selectionLocked = attemptPending || state.phase === "requesting-intent" || active ||
    (terminal && Boolean(state.sessionId) && !state.reconciled);
  const setupAvailable = state.phase === "idle" || (state.phase === "failed" && !state.sessionId);
  const status = technicalStatus(state.status) ?? phaseLabel(state.phase);
  const authoritativeTerminal = terminal && state.reconciled;

  useEffect(() => {
    onPhaseChange?.(selectionLocked);
  }, [onPhaseChange, selectionLocked]);

  useEffect(() => {
    onLivePhaseChange?.(live);
  }, [live, onLivePhaseChange]);

  useEffect(() => {
    onTechnicalPendingChange?.(Boolean(state.sessionId) && !state.reconciled);
  }, [onTechnicalPendingChange, state.reconciled, state.sessionId]);

  useEffect(() => {
    if (state.phase === "failed" && !state.sessionId) {
      attemptPhoneIdRef.current = null;
      setAttemptPending(false);
      return;
    }
    if (state.phase === "idle" || (terminal && state.reconciled))
      setAttemptPending(false);
  }, [state.phase, state.reconciled, state.sessionId, terminal]);

  function reset() {
    computerCall.reset();
    emittedSessionRef.current = null;
    attemptPhoneIdRef.current = null;
    setAttemptPending(false);
    onReset?.();
  }

  function close() {
    computerCall.reset();
    emittedSessionRef.current = null;
    attemptPhoneIdRef.current = null;
    setAttemptPending(false);
    onClose?.();
  }

  function callNow() {
    const attempt = computerCall.callNow();
    if (attempt && "accepted" in attempt && !attempt.accepted) return;
    attemptPhoneIdRef.current ??= phone.id;
    setAttemptPending(true);
    onPhaseChange?.(true);
  }

  return (
    <section className="mt-4 grid gap-4 rounded-xl border border-violet-200 bg-violet-50 p-4" aria-labelledby="computer-call-title">
      <div>
        <h3 className="font-bold text-violet-950" id="computer-call-title" ref={headingRef} tabIndex={-1}>Computer call</h3>
        <p className="mt-1 text-sm text-violet-950">Calling <strong>{contact.name}</strong> at <strong>{phone.number}</strong>.</p>
        <p className="mt-1 text-sm text-violet-950">This outbound call will show the Adventure Zone work number: {callerIdDisplay}.</p>
      </div>

      <p aria-atomic="true" aria-live="polite" className="font-semibold text-violet-950" role="status">{status}</p>
      {state.startedAt && (!terminal || authoritativeTerminal) ? <p aria-live="off" className="text-sm text-violet-950">Duration: {duration(state.durationSeconds, state.startedAt, state.endedAt, now)}</p> : null}
      {state.error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{state.error}</p> : null}
      {terminal && !authoritativeTerminal ? <p className="text-sm text-slate-700">Confirming technical call details before recording the outcome.</p> : null}
      {authoritativeTerminal && state.status ? <p className="text-sm text-slate-700">Technical result: {status.toLowerCase()}</p> : null}
      {authoritativeTerminal && state.errorSummary ? <p className="text-sm text-slate-700">{state.errorSummary}</p> : null}
      {authoritativeTerminal && state.answeredAt ? <p className="text-sm text-slate-700">Answered: {state.answeredAt}</p> : null}
      {authoritativeTerminal && state.endedAt ? <p className="text-sm text-slate-700">Ended: {state.endedAt}</p> : null}
      {state.warning ? <p className="text-sm text-amber-800" role="status">{state.warning}</p> : null}

      {!terminal && state.inputs.length ? (
        <label className="grid gap-1.5 font-medium" htmlFor="computer-call-input">
          Microphone
          <select id="computer-call-input" onChange={(event) => void computerCall.selectInput(event.target.value)} value={state.inputDeviceId ?? ""}>
            <option value="" disabled>Select a microphone</option>
            {state.inputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}
          </select>
        </label>
      ) : null}
      {!terminal && state.outputs.length ? (
        <label className="grid gap-1.5 font-medium" htmlFor="computer-call-output">
          Speaker
          <select id="computer-call-output" onChange={(event) => void computerCall.selectOutput(event.target.value)} value={state.outputDeviceId ?? ""}>
            <option value="" disabled>Select a speaker</option>
            {state.outputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || "Speaker"}</option>)}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {setupAvailable ? <button className="button-primary" onClick={() => void computerCall.setup()} type="button">Set up microphone</button> : null}
        {state.phase === "ready" ? <button className="button-primary" disabled={attemptPending} onClick={callNow} type="button">Call now</button> : null}
        {state.phase === "connected" ? <button className="button-secondary" onClick={() => computerCall.mute(!state.muted)} type="button">{state.muted ? "Unmute microphone" : "Mute microphone"}</button> : null}
        {active ? <button className="button-secondary" onClick={computerCall.hangUp} type="button">Hang up</button> : null}
        {terminal ? <button className="button-secondary" onClick={reset} type="button">Set up another call</button> : null}
        <button className="button-secondary" onClick={close} type="button">Cancel computer call</button>
      </div>

      {terminal && state.sessionId && !state.reconciled ? (
        <button className="button-secondary" onClick={computerCall.refresh} type="button">Refresh technical details</button>
      ) : null}

      {state.phase === "connected" ? (
        <fieldset className="grid gap-2">
          <legend className="font-medium">Keypad</legend>
          <div className="grid max-w-48 grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((digit) => (
              <button aria-label={`Keypad ${digit}`} className="button-secondary" key={digit} onClick={() => computerCall.sendDigits(digit)} type="button">{digit}</button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {(state.phase === "failed" || state.warning) ? <p className="text-sm text-slate-700">Phone Link remains available if computer calling cannot continue.</p> : null}
    </section>
  );
}
