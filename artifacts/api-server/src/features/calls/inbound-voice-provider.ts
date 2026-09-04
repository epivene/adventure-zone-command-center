export interface SignedWebhookInput { signature: string; url: string; params: Record<string, string>; }
export interface ProviderRecordingMedia { body: NodeJS.ReadableStream; contentType?: string; }
export interface InboundVoiceProvider {
  createBrowserToken(input: { identity: string; ttlSeconds: number; allowIncoming: boolean }): Promise<{ token: string; expiresAt: Date }>;
  validateWebhook(input: SignedWebhookInput): boolean;
  createClientDialTwiml(input: { identity: string; sessionId: string; actionUrl: string; statusCallbackUrl: string }): string;
  createVoicemailTwiml(input: { actionUrl: string; recordingStatusCallbackUrl: string; maxSeconds: number }): string;
  redirectCallToVoicemail(input: { callSid: string; twiml: string }): Promise<void>;
  createUnavailableTwiml(): string;
  getRecordingMedia(recordingSid: string): Promise<ProviderRecordingMedia>;
  deleteRecording(recordingSid: string): Promise<"deleted" | "already_absent">;
}
