import { describe, expect, it } from "vitest";

import {
  IncomingAvailabilityService,
} from "./incoming-availability-service";
import type {
  IncomingAvailabilityRepository,
} from "./incoming-availability-repository";
import type {
  LeaseMutation,
  ResolvedLease,
} from "./incoming-availability-types";

class MemoryAvailabilityRepository implements IncomingAvailabilityRepository {
  lease: (LeaseMutation & { activeInboundSessionId: string | null }) | null = null;

  async acquire(input: LeaseMutation, now: Date, takeover: boolean) {
    if (
      this.lease &&
      this.lease.expiresAt > now &&
      (!takeover || this.lease.activeInboundSessionId)
    ) return false;
    this.lease = { ...input, activeInboundSessionId: null };
    return true;
  }

  async renew(input: {
    ownerId: string;
    leaseId: string;
    leaseTokenHash: string;
    expiresAt: Date;
    now: Date;
  }) {
    if (
      !this.lease ||
      this.lease.ownerId !== input.ownerId ||
      this.lease.leaseId !== input.leaseId ||
      this.lease.leaseTokenHash !== input.leaseTokenHash ||
      this.lease.expiresAt <= input.now
    ) return false;
    this.lease.expiresAt = input.expiresAt;
    return true;
  }

  async release(input: {
    ownerId: string;
    leaseId: string;
    leaseTokenHash: string;
  }) {
    if (
      !this.lease ||
      this.lease.ownerId !== input.ownerId ||
      this.lease.leaseId !== input.leaseId ||
      this.lease.leaseTokenHash !== input.leaseTokenHash ||
      this.lease.activeInboundSessionId
    ) return false;
    this.lease = null;
    return true;
  }

  async verify(
    input: { ownerId: string; leaseId: string; leaseTokenHash: string },
    now: Date,
  ) {
    return this.matches(input, now) ? this.resolved() : null;
  }

  async resolveOwner(ownerId: string, now: Date) {
    return this.lease?.ownerId === ownerId && this.lease.expiresAt > now
      ? this.resolved()
      : null;
  }

  async resolveIdentity(identity: string, now: Date) {
    return this.lease?.clientIdentity === identity && this.lease.expiresAt > now
      ? this.resolved()
      : null;
  }

  private matches(
    input: { ownerId: string; leaseId: string; leaseTokenHash: string },
    now: Date,
  ) {
    return Boolean(
      this.lease &&
      this.lease.ownerId === input.ownerId &&
      this.lease.leaseId === input.leaseId &&
      this.lease.leaseTokenHash === input.leaseTokenHash &&
      this.lease.expiresAt > now,
    );
  }

  private resolved(): ResolvedLease {
    if (!this.lease) throw new Error("missing lease");
    return {
      leaseId: this.lease.leaseId,
      ownerId: this.lease.ownerId,
      clientIdentity: this.lease.clientIdentity,
      expiresAt: this.lease.expiresAt,
      activeInboundSessionId: this.lease.activeInboundSessionId,
    };
  }
}

describe("IncomingAvailabilityService", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  it("normalizes generated client identities to Twilio's allowed character set", async () => {
    const repository = new MemoryAvailabilityRepository();
    const service = new IncomingAvailabilityService(
      repository,
      () => now,
      () => "r0_CtRD1SA_IUfxwmwJJ_QMeszf2ukkqNs0bEyxU-XM",
    );

    const lease = await service.acquire({
      ownerId: "owner",
      browserSessionId: "browser-session-a",
    });

    expect(lease.clientIdentity).toBe(
      "inbound_r0_CtRD1SA_IUfxwmwJJ_QMeszf2ukkqNs0bEyxU_XM",
    );
  });

  it("authorizes only the current hashed lease secret", async () => {
    const repository = new MemoryAvailabilityRepository();
    const service = new IncomingAvailabilityService(
      repository,
      () => now,
      () => "deterministic-secret-value-that-is-long-enough",
    );
    const lease = await service.acquire({
      ownerId: "owner",
      browserSessionId: "browser-session-a",
    });

    await expect(service.authorize({
      ownerId: "owner",
      leaseId: lease.leaseId,
      leaseSecret: lease.leaseSecret,
    })).resolves.toMatchObject({ leaseId: lease.leaseId });
    await expect(service.authorize({
      ownerId: "owner",
      leaseId: lease.leaseId,
      leaseSecret: "wrong-secret-value-that-is-long-enough",
    })).rejects.toThrow("stale_lease");
    expect(repository.lease?.leaseTokenHash).not.toBe(lease.leaseSecret);
  });

  it("refuses takeover while an inbound call owns the active lease", async () => {
    const repository = new MemoryAvailabilityRepository();
    const service = new IncomingAvailabilityService(
      repository,
      () => now,
      () => "deterministic-secret-value-that-is-long-enough",
    );
    await service.acquire({
      ownerId: "owner",
      browserSessionId: "browser-session-a",
    });
    if (!repository.lease) throw new Error("missing lease");
    repository.lease.activeInboundSessionId =
      "00000000-0000-4000-8000-000000000001";

    await expect(service.takeover({
      ownerId: "owner",
      browserSessionId: "browser-session-b",
    })).rejects.toThrow("lease_unavailable");
  });
});
