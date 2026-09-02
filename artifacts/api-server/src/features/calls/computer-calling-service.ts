import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { contactPhones, organizationContacts } from "@/db/schema";
import type {
  ComputerCallRepository,
  ComputerCallSessionRecord,
  ProviderStatusUpdate,
} from "./computer-call-repository";
import type { ComputerCallSession } from "./computer-calling-types";
import { normalizeNanpPhone } from "./nanp-phone";

export type ComputerCallingErrorCode =
  | "feature_disabled"
  | "phone_not_found"
  | "phone_context_mismatch"
  | "calling_suppressed"
  | "phone_invalid"
  | "intent_expired"
  | "intent_already_used";

export class ComputerCallingError extends Error {
  readonly name = "ComputerCallingError";

  constructor(readonly code: ComputerCallingErrorCode) {
    super(code);
  }
}

export type ComputerCallingAvailability =
  | { enabled: true; callerId: string }
  | { enabled: false };

export interface ComputerCallingPhone {
  id: string;
  contactId: string;
  number: string | null;
  doNotCallAt: Date | null;
}

export interface ComputerCallingPhoneContextRepository {
  findPhone(phoneId: string): Promise<ComputerCallingPhone | null>;
  hasActiveOrganizationContact(input: {
    organizationId: string;
    contactId: string;
  }): Promise<boolean>;
}

export interface ConsumedCallIntent {
  sessionId: string;
  providerCallSid: string;
  destination: string;
  callerId: string;
}

export interface ComputerCallingService {
  createIntent(input: {
    ownerId: "owner";
    organizationId: string;
    contactId: string;
    phoneId: string;
    now: Date;
  }): Promise<{ sessionId: string; expiresAt: string }>;
  consumeIntent(input: {
    sessionId: string;
    providerCallSid: string;
    callerIdentity: string;
    now: Date;
  }): Promise<ConsumedCallIntent>;
  applyProviderStatus(input: ProviderStatusUpdate): Promise<void>;
  getSession(input: {
    ownerId: "owner";
    sessionId: string;
  }): Promise<ComputerCallSession>;
}

function publicSession(session: ComputerCallSessionRecord): ComputerCallSession {
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt?.toISOString() ?? null,
    answeredAt: session.answeredAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    durationSeconds: session.durationSeconds,
    errorSummary: session.errorSummary,
  };
}

type DrizzleDatabase = typeof database;

export class DefaultComputerCallingService implements ComputerCallingService {
  constructor(
    private readonly repository: ComputerCallRepository,
    private readonly phoneContext: ComputerCallingPhoneContextRepository,
    private readonly availability: () => ComputerCallingAvailability,
  ) {}

  async createIntent(input: {
    ownerId: "owner";
    organizationId: string;
    contactId: string;
    phoneId: string;
    now: Date;
  }): Promise<{ sessionId: string; expiresAt: string }> {
    const availability = this.availability();
    if (!availability.enabled) throw new ComputerCallingError("feature_disabled");

    const phone = await this.phoneContext.findPhone(input.phoneId);
    if (!phone) throw new ComputerCallingError("phone_not_found");
    if (phone.contactId !== input.contactId) {
      throw new ComputerCallingError("phone_context_mismatch");
    }
    const activeRelationship = await this.phoneContext.hasActiveOrganizationContact({
      organizationId: input.organizationId,
      contactId: input.contactId,
    });
    if (!activeRelationship) {
      throw new ComputerCallingError("phone_context_mismatch");
    }
    if (phone.doNotCallAt) throw new ComputerCallingError("calling_suppressed");

    const destination = phone.number ? normalizeNanpPhone(phone.number) : null;
    if (!destination) throw new ComputerCallingError("phone_invalid");

    const intentExpiresAt = new Date(input.now.getTime() + 2 * 60 * 1_000);
    const created = await this.repository.createIntent({
      ownerId: input.ownerId,
      organizationId: input.organizationId,
      contactId: input.contactId,
      phoneId: input.phoneId,
      callerIdSnapshot: availability.callerId,
      destinationNumberSnapshot: destination,
      intentExpiresAt,
      createdAt: input.now,
    });

    return {
      sessionId: created.id,
      expiresAt: created.intentExpiresAt.toISOString(),
    };
  }

  async consumeIntent(input: {
    sessionId: string;
    providerCallSid: string;
    callerIdentity: string;
    now: Date;
  }): Promise<ConsumedCallIntent> {
    if (!this.availability().enabled) {
      throw new ComputerCallingError("feature_disabled");
    }

    const result = await this.repository.consumeIntent({
      id: input.sessionId,
      providerCallSid: input.providerCallSid,
      callerIdentity: input.callerIdentity,
      now: input.now,
    });
    if (!("session" in result)) {
      if (result.kind === "expired") throw new ComputerCallingError("intent_expired");
      throw new ComputerCallingError("intent_already_used");
    }
    if (result.session.ownerId !== input.callerIdentity) {
      throw new ComputerCallingError("intent_already_used");
    }

    return {
      sessionId: result.session.id,
      providerCallSid: result.session.providerCallSid ?? input.providerCallSid,
      destination: result.session.destinationNumberSnapshot,
      callerId: result.session.callerIdSnapshot,
    };
  }

  async applyProviderStatus(input: ProviderStatusUpdate): Promise<void> {
    await this.repository.updateProviderStatus(input);
  }

  async getSession(input: {
    ownerId: "owner";
    sessionId: string;
  }): Promise<ComputerCallSession> {
    const session = await this.repository.getSessionForOwner({
      id: input.sessionId,
      ownerId: input.ownerId,
    });
    if (!session) throw new ComputerCallingError("intent_already_used");
    return publicSession(session);
  }
}

export class DrizzleComputerCallingPhoneContextRepository
implements ComputerCallingPhoneContextRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async findPhone(phoneId: string): Promise<ComputerCallingPhone | null> {
    const [phone] = await this.database
      .select({
        id: contactPhones.id,
        contactId: contactPhones.contactId,
        number: contactPhones.number,
        doNotCallAt: contactPhones.doNotCallAt,
      })
      .from(contactPhones)
      .where(eq(contactPhones.id, phoneId))
      .limit(1);
    return phone ?? null;
  }

  async hasActiveOrganizationContact(input: {
    organizationId: string;
    contactId: string;
  }): Promise<boolean> {
    const [relationship] = await this.database
      .select({ id: organizationContacts.id })
      .from(organizationContacts)
      .where(and(
        eq(organizationContacts.organizationId, input.organizationId),
        eq(organizationContacts.contactId, input.contactId),
        eq(organizationContacts.active, true),
      ))
      .limit(1);
    return Boolean(relationship);
  }
}
