export const INCOMING_LEASE_MS = 45_000;
export const INCOMING_HEARTBEAT_MS = 15_000;
export type LeaseResult = { leaseId: string; clientIdentity: string; leaseSecret: string; expiresAt: Date };
export type ResolvedLease = { leaseId: string; ownerId: string; clientIdentity: string; expiresAt: Date; activeInboundSessionId: string | null };
export type LeaseMutation = Omit<LeaseResult, "leaseSecret"> & { leaseTokenHash: string; browserSessionId: string; ownerId: string };