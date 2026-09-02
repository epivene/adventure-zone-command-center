import { describe, expect, it } from "vitest";

import type {
  ComputerCallRepository,
  ComputerCallSessionRecord,
  ConsumeIntentResult,
  CreateComputerCallIntentRecord,
  ProviderStatusUpdate,
} from "./computer-call-repository";
import {
  DefaultComputerCallingService,
  type ComputerCallingAvailability,
  type ComputerCallingPhone,
  type ComputerCallingPhoneContextRepository,
} from "./computer-calling-service";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHONE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-09-02T12:00:00.000Z");

function sessionRecord(
  overrides: Partial<ComputerCallSessionRecord> = {},
): ComputerCallSessionRecord {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ownerId: "owner",
    organizationId: ORGANIZATION_ID,
    contactId: CONTACT_ID,
    phoneId: PHONE_ID,
    provider: "twilio",
    providerCallSid: null,
    direction: "outbound",
    method: "browser_voip",
    status: "created",
    callerIdSnapshot: "+15557654321",
    destinationNumberSnapshot: "+15551234567",
    intentExpiresAt: new Date("2026-09-02T12:02:00.000Z"),
    intentConsumedAt: null,
    createdAt: NOW,
    startedAt: null,
    answeredAt: null,
    endedAt: null,
    updatedAt: NOW,
    durationSeconds: null,
    errorCode: null,
    errorSummary: null,
    ...overrides,
  };
}

class MemoryCallRepository implements ComputerCallRepository {
  session: ComputerCallSessionRecord | null = null;
  lastStatusUpdate: ProviderStatusUpdate | null = null;

  async createIntent(input: CreateComputerCallIntentRecord) {
    this.session = sessionRecord({
      ownerId: input.ownerId,
      organizationId: input.organizationId,
      contactId: input.contactId,
      phoneId: input.phoneId,
      callerIdSnapshot: input.callerIdSnapshot,
      destinationNumberSnapshot: input.destinationNumberSnapshot,
      intentExpiresAt: input.intentExpiresAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    return this.session;
  }

  async consumeIntent(input: {
    id: string;
    providerCallSid: string;
    callerIdentity: string;
    now: Date;
  }): Promise<ConsumeIntentResult> {
    if (!this.session || this.session.id !== input.id || this.session.ownerId !== input.callerIdentity) {
      return { kind: "not_found" };
    }
    if (this.session.providerCallSid === input.providerCallSid) {
      return { kind: "retry", session: this.session };
    }
    if (this.session.providerCallSid || this.session.intentConsumedAt) {
      return { kind: "already_bound" };
    }
    if (this.session.intentExpiresAt <= input.now) return { kind: "expired" };
    this.session = {
      ...this.session,
      providerCallSid: input.providerCallSid,
      intentConsumedAt: input.now,
      updatedAt: input.now,
    };
    return { kind: "consumed", session: this.session };
  }

  async updateProviderStatus(input: ProviderStatusUpdate) {
    this.lastStatusUpdate = input;
    if (!this.session || this.session.providerCallSid !== input.providerCallSid) return null;
    this.session = {
      ...this.session,
      status: input.status,
      updatedAt: input.occurredAt,
    };
    return this.session;
  }

  async getSessionForOwner(input: { id: string; ownerId: string }) {
    return this.session?.id === input.id && this.session.ownerId === input.ownerId
      ? this.session
      : null;
  }
}

class MemoryPhoneContextRepository implements ComputerCallingPhoneContextRepository {
  phone: ComputerCallingPhone | null = {
    id: PHONE_ID,
    contactId: CONTACT_ID,
    number: "(555) 123-4567",
    doNotCallAt: null,
  };
  activeRelationship = true;

  async findPhone(phoneId: string) {
    return this.phone?.id === phoneId ? this.phone : null;
  }

  async hasActiveOrganizationContact(input: { organizationId: string; contactId: string }) {
    return this.activeRelationship
      && input.organizationId === ORGANIZATION_ID
      && input.contactId === CONTACT_ID;
  }
}

function serviceFixture(
  availability: ComputerCallingAvailability = {
    enabled: true,
    callerId: "+15557654321",
  },
) {
  const calls = new MemoryCallRepository();
  const phones = new MemoryPhoneContextRepository();
  const service = new DefaultComputerCallingService(calls, phones, () => availability);
  return { service, calls, phones };
}

const createInput = {
  ownerId: "owner" as const,
  organizationId: ORGANIZATION_ID,
  contactId: CONTACT_ID,
  phoneId: PHONE_ID,
  now: NOW,
};

describe("DefaultComputerCallingService", () => {
  it("fails closed when computer calling is disabled", async () => {
    const { service } = serviceFixture({ enabled: false });

    await expect(service.createIntent(createInput)).rejects.toMatchObject({
      code: "feature_disabled",
    });
  });

  it("rejects a missing stored phone", async () => {
    const { service, phones } = serviceFixture();
    phones.phone = null;

    await expect(service.createIntent(createInput)).rejects.toMatchObject({
      code: "phone_not_found",
    });
  });

  it("rejects a phone belonging to another contact", async () => {
    const { service, phones } = serviceFixture();
    phones.phone = { ...phones.phone!, contactId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };

    await expect(service.createIntent(createInput)).rejects.toMatchObject({
      code: "phone_context_mismatch",
    });
  });

  it("rejects a contact without an active organization relationship", async () => {
    const { service, phones } = serviceFixture();
    phones.activeRelationship = false;

    await expect(service.createIntent(createInput)).rejects.toMatchObject({
      code: "phone_context_mismatch",
    });
  });

  it("rejects a Do Not Call or otherwise suppressed phone", async () => {
    const { service, phones } = serviceFixture();
    phones.phone = { ...phones.phone!, doNotCallAt: new Date("2026-08-01T00:00:00.000Z") };

    await expect(service.createIntent(createInput)).rejects.toMatchObject({
      code: "calling_suppressed",
    });
  });

  it("rejects a stored phone without a full number", async () => {
    const { service, phones } = serviceFixture();
    phones.phone = { ...phones.phone!, number: null };

    await expect(service.createIntent(createInput)).rejects.toMatchObject({
      code: "phone_invalid",
    });
  });

  it("rejects a stored phone that is not a callable NANP number", async () => {
    const { service, phones } = serviceFixture();
    phones.phone = { ...phones.phone!, number: "+44 20 7946 0958" };

    await expect(service.createIntent(createInput)).rejects.toMatchObject({
      code: "phone_invalid",
    });
  });

  it("snapshots the server-resolved destination and returns a two-minute intent", async () => {
    const { service, calls } = serviceFixture();

    await expect(service.createIntent(createInput)).resolves.toEqual({
      sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      expiresAt: "2026-09-02T12:02:00.000Z",
    });
    expect(calls.session).toEqual(expect.objectContaining({
      ownerId: "owner",
      callerIdSnapshot: "+15557654321",
      destinationNumberSnapshot: "+15551234567",
      status: "created",
    }));
  });

  it("consumes an intent using the signed browser caller identity", async () => {
    const { service } = serviceFixture();
    const created = await service.createIntent(createInput);

    await expect(service.consumeIntent({
      sessionId: created.sessionId,
      providerCallSid: "CA-success",
      callerIdentity: "owner",
      now: NOW,
    })).resolves.toEqual({
      sessionId: created.sessionId,
      providerCallSid: "CA-success",
      destination: "+15551234567",
      callerId: "+15557654321",
    });
  });

  it("fails closed at consumption time when calling has been disabled", async () => {
    const enabled = serviceFixture();
    const created = await enabled.service.createIntent(createInput);
    const disabledService = new DefaultComputerCallingService(
      enabled.calls,
      enabled.phones,
      () => ({ enabled: false }),
    );

    await expect(disabledService.consumeIntent({
      sessionId: created.sessionId,
      providerCallSid: "CA-disabled",
      callerIdentity: "owner",
      now: NOW,
    })).rejects.toMatchObject({ code: "feature_disabled" });
  });

  it("fails an identity mismatch with the same generic used-intent error", async () => {
    const { service } = serviceFixture();
    const created = await service.createIntent(createInput);

    await expect(service.consumeIntent({
      sessionId: created.sessionId,
      providerCallSid: "CA-attacker",
      callerIdentity: "not-owner",
      now: NOW,
    })).rejects.toMatchObject({ code: "intent_already_used" });
  });

  it("maps expired and rebound intents to stable errors", async () => {
    const expired = serviceFixture();
    const expiredIntent = await expired.service.createIntent(createInput);
    await expect(expired.service.consumeIntent({
      sessionId: expiredIntent.sessionId,
      providerCallSid: "CA-expired",
      callerIdentity: "owner",
      now: new Date("2026-09-02T12:02:00.000Z"),
    })).rejects.toMatchObject({ code: "intent_expired" });

    const rebound = serviceFixture();
    const reboundIntent = await rebound.service.createIntent(createInput);
    await rebound.service.consumeIntent({
      sessionId: reboundIntent.sessionId,
      providerCallSid: "CA-first",
      callerIdentity: "owner",
      now: NOW,
    });
    await expect(rebound.service.consumeIntent({
      sessionId: reboundIntent.sessionId,
      providerCallSid: "CA-second",
      callerIdentity: "owner",
      now: NOW,
    })).rejects.toMatchObject({ code: "intent_already_used" });
  });

  it("applies provider updates without exposing repository records", async () => {
    const { service, calls } = serviceFixture();
    const created = await service.createIntent(createInput);
    await service.consumeIntent({
      sessionId: created.sessionId,
      providerCallSid: "CA-status",
      callerIdentity: "owner",
      now: NOW,
    });
    const update: ProviderStatusUpdate = {
      providerCallSid: "CA-status",
      status: "ringing",
      occurredAt: new Date("2026-09-02T12:00:10.000Z"),
    };

    await expect(service.applyProviderStatus(update)).resolves.toBeUndefined();
    expect(calls.lastStatusUpdate).toEqual(update);
  });

  it("serializes only the owner-scoped public session fields", async () => {
    const { service, calls } = serviceFixture();
    calls.session = sessionRecord({
      status: "completed",
      providerCallSid: "CA-secret",
      startedAt: new Date("2026-09-02T12:00:10.000Z"),
      answeredAt: new Date("2026-09-02T12:00:20.000Z"),
      endedAt: new Date("2026-09-02T12:01:30.000Z"),
      durationSeconds: 80,
      errorSummary: null,
    });

    await expect(service.getSession({
      ownerId: "owner",
      sessionId: calls.session.id,
    })).resolves.toEqual({
      id: calls.session.id,
      status: "completed",
      startedAt: "2026-09-02T12:00:10.000Z",
      answeredAt: "2026-09-02T12:00:20.000Z",
      endedAt: "2026-09-02T12:01:30.000Z",
      durationSeconds: 80,
      errorSummary: null,
    });
    await expect(service.getSession({
      ownerId: "not-owner" as "owner",
      sessionId: calls.session.id,
    })).rejects.toMatchObject({ code: "intent_already_used" });
  });
});
