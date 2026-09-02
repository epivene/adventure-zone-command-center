export type ComputerCallProvider = "twilio";

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

export interface ComputerCallingCapability {
  enabled: boolean;
  reason: "available" | "disabled" | "configuration_incomplete";
  callerIdDisplay: string | null;
}

export interface ComputerCallSession {
  id: string;
  status: ComputerCallStatus;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  errorSummary: string | null;
}
