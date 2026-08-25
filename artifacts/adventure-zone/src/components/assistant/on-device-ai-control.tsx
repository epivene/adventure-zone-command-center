import { useEffect, useState } from "react";

import {
  getOnDeviceAiState,
  initializeOnDeviceAi,
  setOnDeviceAiEnabled,
  subscribeOnDeviceAi,
  type OnDeviceAiProgress,
} from "@/features/assistant/on-device-ai-runtime";

export function OnDeviceAiControl() {
  const [state, setState] = useState<OnDeviceAiProgress>(() => getOnDeviceAiState());

  useEffect(() => subscribeOnDeviceAi(setState), []);

  async function enable() {
    setOnDeviceAiEnabled(true);
    await initializeOnDeviceAi();
  }

  async function retry() {
    await initializeOnDeviceAi();
  }

  if (state.status === "disabled") {
    return (
      <div className="border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-700">On-device AI</p>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Free local matching on this device. Downloads a small model.</p>
          </div>
          <button className="button-secondary shrink-0" onClick={() => { void enable(); }} type="button">Enable</button>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    const progress = state.progress == null ? null : Math.round(state.progress);
    return (
      <div className="border-b border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold">Loading on-device AI…</p>
            {state.message ? <p className="mt-0.5 truncate text-[11px] text-blue-700">{state.message}</p> : null}
          </div>
          {progress == null ? null : <span className="font-bold">{progress}%</span>}
        </div>
        {progress == null ? null : (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100" aria-hidden="true">
            <div className="h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    );
  }

  if (state.status === "ready") {
    return (
      <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-emerald-900">On-device ready</p>
            <p className="mt-0.5 text-[11px] text-emerald-700">Eligible cached-context questions can stay on this device.</p>
          </div>
          <button className="button-secondary shrink-0" onClick={() => setOnDeviceAiEnabled(false)} type="button">Turn off</button>
        </div>
      </div>
    );
  }

  if (state.status === "error" || state.status === "unavailable") {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-amber-900">On-device AI unavailable</p>
            <p className="mt-0.5 text-[11px] leading-4 text-amber-800">{state.message || "This browser cannot use the local AI runtime right now."}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {state.status === "error" ? <button className="button-secondary" onClick={() => { void retry(); }} type="button">Retry</button> : null}
            <button className="button-secondary" onClick={() => setOnDeviceAiEnabled(false)} type="button">Turn off</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
