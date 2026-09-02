import { Device, type Call } from "@twilio/voice-sdk";
import type {
  BrowserVoiceCall,
  BrowserVoiceDevice,
} from "./computer-calling-types";

class TwilioBrowserVoiceCall implements BrowserVoiceCall {
  constructor(private readonly call: Call) {}

  mute(value: boolean): void {
    this.call.mute(value);
  }

  sendDigits(value: string): void {
    this.call.sendDigits(value);
  }

  disconnect(): void {
    this.call.disconnect();
  }

  on(
    event: "ringing" | "accept" | "disconnect" | "cancel" | "error",
    listener: (...args: unknown[]) => void,
  ): void {
    this.call.on(event, listener as never);
  }

  removeListeners(): void {
    this.call.removeAllListeners();
  }
}

/** Keeps Twilio SDK objects behind the browser voice adapter boundary. */
export class TwilioBrowserDevice implements BrowserVoiceDevice {
  private device: Device | null = null;
  private readonly calls = new Set<TwilioBrowserVoiceCall>();

  async prepare(token: string): Promise<void> {
    await this.destroy();
    const device = new Device(token);
    this.device = device;
  }

  async connect(params: { sessionId: string }): Promise<BrowserVoiceCall> {
    const device = this.requireDevice();
    const call = await device.connect({
      params: { sessionId: params.sessionId },
    });
    const wrapped = new TwilioBrowserVoiceCall(call);
    this.calls.add(wrapped);
    return wrapped;
  }

  async listAudioDevices(): Promise<{
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
  }> {
    const audio = this.requireDevice().audio;
    if (!audio) return { inputs: [], outputs: [] };
    return {
      inputs: [...audio.availableInputDevices.values()],
      outputs: [...audio.availableOutputDevices.values()],
    };
  }

  async selectInput(deviceId: string): Promise<void> {
    const audio = this.requireDevice().audio;
    if (!audio) throw new Error("Audio devices are unavailable.");
    await audio.setInputDevice(deviceId);
  }

  async selectOutput(deviceId: string): Promise<boolean> {
    const audio = this.requireDevice().audio;
    if (!audio || !audio.isOutputSelectionSupported) return false;
    await Promise.all([
      audio.speakerDevices.set(deviceId),
      audio.ringtoneDevices.set(deviceId),
    ]);
    return true;
  }

  async destroy(): Promise<void> {
    for (const call of this.calls) {
      call.removeListeners();
      call.disconnect();
    }
    this.calls.clear();
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
  }

  private requireDevice(): Device {
    if (!this.device) throw new Error("Computer calling is not prepared.");
    return this.device;
  }
}
