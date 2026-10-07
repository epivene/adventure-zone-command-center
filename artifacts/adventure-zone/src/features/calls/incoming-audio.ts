import type { BrowserVoiceDevice } from "./computer-calling-types";

export type IncomingAudioPreferences = { inputId?: string; outputId?: string };
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const preferenceKey = "az.incoming-call.audio.v1";

export function readIncomingAudioPreferences(storage?: PreferenceStorage): IncomingAudioPreferences {
  try {
    const value = JSON.parse((storage ?? window.localStorage).getItem(preferenceKey) ?? "{}");
    return {
      ...(typeof value?.inputId === "string" ? { inputId: value.inputId } : {}),
      ...(typeof value?.outputId === "string" ? { outputId: value.outputId } : {}),
    };
  } catch { return {}; }
}
export function saveIncomingAudioPreferences(preferences: IncomingAudioPreferences, storage?: PreferenceStorage) {
  try { (storage ?? window.localStorage).setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Browser storage can be disabled. */ }
}

function availableId(devices: MediaDeviceInfo[], saved?: string): string {
  if (saved && devices.some(device => device.deviceId === saved)) return saved;
  return devices.find(device => device.deviceId === "default")?.deviceId ?? devices[0]?.deviceId ?? "default";
}

/** Apply audio to the inbound Device before registration; setInputDevice keeps the mic ready. */
export async function prepareIncomingAudio(device: BrowserVoiceDevice, preferences: IncomingAudioPreferences) {
  const { inputs, outputs } = await device.listAudioDevices();
  const inputId = availableId(inputs, preferences.inputId);
  const outputId = availableId(outputs, preferences.outputId);
  const missing = (preferences.inputId && preferences.inputId !== inputId)
    || (preferences.outputId && preferences.outputId !== outputId);
  await device.selectInput(inputId);
  const outputSupported = await device.selectOutput(outputId);
  return {
    inputs, outputs, inputId, outputId: outputSupported ? outputId : "", outputSupported,
    warning: [
      missing ? "A saved audio device is no longer available. Check the current microphone and speaker." : "",
      !outputSupported ? "This browser uses the system speaker. Choose your headphones in computer sound settings." : "",
    ].filter(Boolean).join(" "),
  };
}
