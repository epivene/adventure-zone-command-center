import type { ComputerCallingCapability } from "./computer-calling-types";

export interface ComputerCallingConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  authToken: string;
  twimlAppSid: string;
  verifiedCallerId: string;
  webhookBaseUrl: string;
}

export type ComputerCallingConfigResult =
  | { enabled: true; config: ComputerCallingConfig; capability: ComputerCallingCapability }
  | { enabled: false; capability: ComputerCallingCapability };

type Environment = Record<string, string | undefined>;

const e164Pattern = /^\+[1-9]\d{1,14}$/;

function requiredValue(env: Environment, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function validWebhookBaseUrl(value: string, nodeEnv: string | undefined): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (
      nodeEnv === "test" && url.protocol === "http:" && url.hostname === "localhost"
    );
  } catch {
    return false;
  }
}

function unavailable(reason: "disabled" | "configuration_incomplete"): ComputerCallingConfigResult {
  return {
    enabled: false,
    capability: {
      enabled: false,
      reason,
      callerIdDisplay: null,
    },
  };
}

export function readTwilioVoiceConfig(env: Environment): ComputerCallingConfig | null {
  const accountSid = requiredValue(env, "TWILIO_ACCOUNT_SID");
  const apiKeySid = requiredValue(env, "TWILIO_API_KEY_SID");
  const apiKeySecret = requiredValue(env, "TWILIO_API_KEY_SECRET");
  const authToken = requiredValue(env, "TWILIO_AUTH_TOKEN");
  const twimlAppSid = requiredValue(env, "TWILIO_TWIML_APP_SID");
  const verifiedCallerId = requiredValue(env, "TWILIO_VERIFIED_CALLER_ID");
  const webhookBaseUrl = requiredValue(env, "TWILIO_WEBHOOK_BASE_URL");

  if (
    !accountSid || !apiKeySid || !apiKeySecret || !authToken || !twimlAppSid || !verifiedCallerId
    || !webhookBaseUrl || !e164Pattern.test(verifiedCallerId)
    || !validWebhookBaseUrl(webhookBaseUrl, env.NODE_ENV)
  ) {
    return null;
  }

  return {
    accountSid,
    apiKeySid,
    apiKeySecret,
    authToken,
    twimlAppSid,
    verifiedCallerId,
    webhookBaseUrl,
  };
}

export function readComputerCallingConfig(env: Environment): ComputerCallingConfigResult {
  if (env.TWILIO_VOICE_ENABLED !== "true") return unavailable("disabled");
  const config = readTwilioVoiceConfig(env);
  if (!config) return unavailable("configuration_incomplete");

  return {
    enabled: true,
    config,
    capability: {
      enabled: true,
      reason: "available",
      callerIdDisplay: config.verifiedCallerId,
    },
  };
}
