export type ComputerCallPhase =
  | "idle"
  | "checking-devices"
  | "ready"
  | "requesting-intent"
  | "connecting"
  | "ringing"
  | "connected"
  | "ending"
  | "completed"
  | "failed";

export type ComputerCallStatus =
  | "created"
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "canceled"
  | "failed"
  | "unknown";

export interface ComputerCallSession {
  id: string;
  status: ComputerCallStatus;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  errorSummary: string | null;
}

export interface ComputerCallIntentContext {
  organizationId: string;
  contactId: string;
  phoneId: string;
}

export interface BrowserVoiceDevice {
  prepare(token: string): Promise<void>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  updateToken(token: string): Promise<void>;
  connect(params: { sessionId: string }): Promise<BrowserVoiceCall>;
  listAudioDevices(): Promise<{
    inputs: MediaDeviceInfo[];
    outputs: MediaDeviceInfo[];
  }>;
  selectInput(deviceId: string): Promise<void>;
  selectOutput(deviceId: string): Promise<boolean>;
  destroy(): Promise<void>;
  on(
    event: "registered" | "unregistered" | "tokenWillExpire" | "incoming" | "error",
    listener: (...args: unknown[]) => void,
  ): void;
}

export interface BrowserVoiceCall {
  mute(value: boolean): void;
  sendDigits(value: string): void;
  disconnect(): void;
  on(
    event: "ringing" | "accept" | "disconnect" | "cancel" | "error",
    listener: (...args: unknown[]) => void,
  ): void;
}

/** An inbound SDK call. Its parameters are untrusted except for the session ID. */
export interface BrowserIncomingCall {
  parameters: Readonly<Record<string, string>>;
  accept(): Promise<void>;
  reject(): void;
  disconnect(): void;
  mute(value: boolean): void;
  sendDigits(value: string): void;
  on(
    event: "accept" | "disconnect" | "cancel" | "error",
    listener: (...args: unknown[]) => void,
  ): void;
}

export interface ComputerCallingApi {
  requestToken(): Promise<{ token: string; expiresAt: string }>;
  createIntent(
    context: ComputerCallIntentContext,
  ): Promise<{ sessionId: string; expiresAt: string }>;
  getSession(sessionId: string): Promise<ComputerCallSession>;
}
