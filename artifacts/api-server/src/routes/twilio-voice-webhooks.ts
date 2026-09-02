import { Router, type Request } from "express";
import { z } from "zod";

import type { ComputerCallingConfigResult } from "@/features/calls/computer-calling-config";
import { ComputerCallingError, type ComputerCallingService } from "@/features/calls/computer-calling-service";
import type { ComputerVoiceProvider } from "@/features/calls/computer-voice-provider";

const formSchema = z.record(z.string(), z.string());
const voiceFieldsSchema = z.object({
  CallSid: z.string().min(1).max(128),
  sessionId: z.string().uuid(),
  From: z.string().regex(/^client:[A-Za-z0-9_-]{1,128}$/).max(135),
}).passthrough();
const statusFieldsSchema = z.object({
  CallSid: z.string().min(1).max(128),
  ParentCallSid: z.string().min(1).max(128).optional(),
  CallStatus: z.string().min(1).max(64),
  CallDuration: z.string().regex(/^\d+$/).optional(),
  ErrorCode: z.string().max(64).optional(),
  ErrorMessage: z.string().max(1_000).optional(),
}).passthrough();

export interface TwilioVoiceWebhooksRouterDependencies {
  service: Pick<ComputerCallingService, "consumeIntent" | "applyProviderStatus">;
  providerForConfig: (config: Extract<ComputerCallingConfigResult, { enabled: true }> ["config"]) => ComputerVoiceProvider;
  getConfig: () => ComputerCallingConfigResult;
  isAssistedCallingEnabled: () => boolean;
  clock?: () => Date;
  logger?: { warn(context: Record<string, string>, message: string): unknown };
}

function activeConfig(dependencies: TwilioVoiceWebhooksRouterDependencies) {
  const result = dependencies.getConfig();
  return dependencies.isAssistedCallingEnabled() && result.enabled ? result.config : null;
}

function safeErrorSummary(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .replace(/\+1\d{10}\b|\b1?\d{10}\b/g, "[redacted-phone]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 500) : null;
}

function safeProviderStatus(value: string): string {
  return value
    .replace(/\+1\d{10}\b|\b1?\d{10}\b/g, "redacted-phone")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
}

function validateSignature(
  request: Request,
  config: Extract<ComputerCallingConfigResult, { enabled: true }> ["config"],
  provider: ComputerVoiceProvider,
  params: Record<string, string>,
): boolean {
  const signature = request.get("X-Twilio-Signature");
  if (!signature) return false;
  const url = new URL(request.originalUrl, config.webhookBaseUrl).toString();
  return provider.validateWebhook({ signature, url, params });
}

export function createTwilioVoiceWebhooksRouter(
  dependencies: TwilioVoiceWebhooksRouterDependencies,
): Router {
  const router = Router();
  const clock = dependencies.clock ?? (() => new Date());

  router.post("/webhooks/twilio/voice/outbound", async (req, res): Promise<void> => {
    const form = formSchema.safeParse(req.body);
    const config = activeConfig(dependencies);
    if (!form.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!config || !validateSignature(req, config, dependencies.providerForConfig(config), form.data)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const fields = voiceFieldsSchema.safeParse(form.data);
    if (!fields.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    try {
      const consumed = await dependencies.service.consumeIntent({
        sessionId: fields.data.sessionId,
        providerCallSid: fields.data.CallSid,
        callerIdentity: fields.data.From.slice("client:".length),
        now: clock(),
      });
      const provider = dependencies.providerForConfig(config);
      const statusCallbackUrl = new URL("/api/webhooks/twilio/voice/status", config.webhookBaseUrl).toString();
      res.type("text/xml").send(provider.createOutboundTwiml({
        destination: consumed.destination,
        callerId: config.verifiedCallerId,
        statusCallbackUrl,
      }));
    } catch (error) {
      if (!(error instanceof ComputerCallingError)) {
        req.log.error({ err: error }, "Twilio outbound voice webhook failed");
      }
      res.status(error instanceof ComputerCallingError ? 403 : 500)
        .json({ error: error instanceof ComputerCallingError ? "Forbidden" : "server_error" });
    }
  });

  router.post("/webhooks/twilio/voice/status", async (req, res): Promise<void> => {
    const form = formSchema.safeParse(req.body);
    const config = activeConfig(dependencies);
    if (!form.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!config || !validateSignature(req, config, dependencies.providerForConfig(config), form.data)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const fields = statusFieldsSchema.safeParse(form.data);
    if (!fields.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    try {
      const provider = dependencies.providerForConfig(config);
      const status = provider.normalizeStatus(fields.data.CallStatus);
      const providerStatus = safeProviderStatus(fields.data.CallStatus);
      const errorSummary = safeErrorSummary(fields.data.ErrorMessage)
        ?? (status === "unknown" ? `Unknown provider status: ${providerStatus}` : null);
      await dependencies.service.applyProviderStatus({
        providerCallSid: fields.data.ParentCallSid ?? fields.data.CallSid,
        status,
        occurredAt: clock(),
        durationSeconds: fields.data.CallDuration ? Number(fields.data.CallDuration) : null,
        errorCode: fields.data.ErrorCode ?? null,
        errorSummary,
      });
      if (status === "unknown") {
        const warning = { providerCallSid: fields.data.ParentCallSid ?? fields.data.CallSid, providerStatus };
        if (dependencies.logger) dependencies.logger.warn(warning, "Unknown Twilio voice status received");
        else req.log?.warn(warning, "Unknown Twilio voice status received");
      }
      res.status(204).send();
    } catch (error) {
      req.log.error({ err: error }, "Twilio voice status webhook failed");
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}
