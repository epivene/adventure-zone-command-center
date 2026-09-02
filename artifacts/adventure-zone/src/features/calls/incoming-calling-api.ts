import { apiFetch } from "@/lib/auth-token";
import type { ComputerCallSession } from "./computer-calling-types";

export type IncomingCallingCapability = {
  enabled: boolean;
  reason?: string;
  inboundNumberDisplay?: string | null;
};
export type IncomingLease = {
  leaseId: string;
  secret: string;
  clientIdentity: string;
  expiresAt: string;
  activeCall: boolean;
};
export type InboundSession = {
  id: string;
  status: string;
  caller: { displayName: string; matched: boolean; organizationId?: string | null; contactId?: string | null; phoneId?: string | null };
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
};

async function result<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/** Authenticated inbound endpoints. Browser credentials stay only in memory. */
export const incomingCallingApi = {
  capability: () => result<IncomingCallingCapability>("/calls/incoming/config"),
  acquireLease: (takeover = false) => result<IncomingLease>("/calls/incoming/availability", { method: "POST", body: JSON.stringify({ takeover }) }),
  renewLease: (leaseId: string, secret: string) => result<IncomingLease>(`/calls/incoming/availability/${encodeURIComponent(leaseId)}`, { method: "PATCH", body: JSON.stringify({ secret }) }),
  releaseLease: (leaseId: string, secret: string) => result<void>(`/calls/incoming/availability/${encodeURIComponent(leaseId)}`, { method: "DELETE", body: JSON.stringify({ secret }) }),
  token: (leaseId: string, secret: string) => result<{ token: string; expiresAt: string }>(`/calls/incoming/availability/${encodeURIComponent(leaseId)}/token`, { method: "POST", body: JSON.stringify({ secret }) }),
  session: (id: string) => result<InboundSession>(`/calls/incoming/sessions/${encodeURIComponent(id)}`),
  sendToVoicemail: (id: string) => result<void>(`/calls/incoming/sessions/${encodeURIComponent(id)}/voicemail`, { method: "POST" }),
  listVoicemail: (params = new URLSearchParams()) => result<VoicemailPage>(`/calls/voicemail?${params}`),
  markVoicemailHandled: (id: string) => result<void>(`/calls/voicemail/${encodeURIComponent(id)}/handled`, { method: "POST" }),
  deleteVoicemailAudio: (id: string) => result<void>(`/calls/voicemail/${encodeURIComponent(id)}/audio`, { method: "DELETE" }),
  playbackUrl: (id: string) => `/api/calls/voicemail/${encodeURIComponent(id)}/audio`,
};

export type Voicemail = {
  id: string; status: "processing" | "available" | "handled" | "deleting" | "audio-deleted" | "failed";
  receivedAt: string; callerDisplay: string; matched: boolean; contactId: string | null; organizationId: string | null; phoneId: string | null;
  durationSeconds: number | null; canCallBack: boolean; callbackReason: string | null; canLink: boolean;
};
export type VoicemailPage = { items: Voicemail[]; nextCursor: string | null; newCount: number; handledCount: number };