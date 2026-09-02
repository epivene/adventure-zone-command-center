import {
  readTwilioVoiceConfig,
  type ComputerCallingConfig,
} from "./computer-calling-config";

type Environment = Record<string, string | undefined>;

export interface InboundCallingConfig {
  inboundNumber: string;
  retentionDays: number;
  maxSeconds: number;
  voiceConfig: ComputerCallingConfig;
}

export type InboundCallingCapability = {
  enabled: boolean;
  reason: "available" | "disabled" | "configuration_incomplete";
  inboundNumberDisplay: string | null;
  retentionDays: number;
  maxSeconds: number;
  missing?: string[];
};

export type InboundCallingConfigResult =
  | { enabled: true; config: InboundCallingConfig; capability: InboundCallingCapability }
  | { enabled: false; capability: InboundCallingCapability };

const e164 = /^\+[1-9]\d{1,14}$/;
const defaults = { retentionDays: 30, maxSeconds: 120 };

function positiveInteger(value: string | undefined, fallback: number): number | null {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function readInboundCallingConfig(env: Environment): InboundCallingConfigResult {
  if (env.TWILIO_INBOUND_VOICE_ENABLED !== "true") {
    return { enabled: false, capability: { enabled: false, reason: "disabled", inboundNumberDisplay: null, ...defaults } };
  }
  const inboundNumber = env.TWILIO_INBOUND_NUMBER?.trim();
  const retentionDays = positiveInteger(env.TWILIO_VOICEMAIL_RETENTION_DAYS, defaults.retentionDays);
  const maxSeconds = positiveInteger(env.TWILIO_VOICEMAIL_MAX_SECONDS, defaults.maxSeconds);
  const voiceConfig = readTwilioVoiceConfig(env);
  const missing = [
    !inboundNumber || !e164.test(inboundNumber) ? "TWILIO_INBOUND_NUMBER" : null,
    retentionDays === null ? "TWILIO_VOICEMAIL_RETENTION_DAYS" : null,
    maxSeconds === null || maxSeconds > 120 ? "TWILIO_VOICEMAIL_MAX_SECONDS" : null,
    !voiceConfig ? "TWILIO_VOICE_CONFIGURATION" : null,
  ].filter((value): value is string => Boolean(value));
  if (missing.length) {
    return { enabled: false, capability: { enabled: false, reason: "configuration_incomplete", inboundNumberDisplay: null, ...defaults, missing } };
  }
  return {
    enabled: true,
    config: {
      inboundNumber: inboundNumber!,
      retentionDays: retentionDays!,
      maxSeconds: maxSeconds!,
      voiceConfig: voiceConfig!,
    },
    capability: { enabled: true, reason: "available", inboundNumberDisplay: `${inboundNumber!.slice(0, 2)}••••${inboundNumber!.slice(-4)}`, retentionDays: retentionDays!, maxSeconds: maxSeconds! },
  };
}