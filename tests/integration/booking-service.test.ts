import { describe, expect, it } from "vitest";

import {
  BookingService,
  type BookingRepository,
  type BookingTransaction,
  type FollowUp,
} from "@/features/bookings/booking-service";
import type {
  AuditEntry,
  Booking,
  CreateFollowUpInput,
  UpdateBookingStatusInput,
} from "@/features/bookings/booking-repository";

const initialBooking: Booking = {
  id: "booking-1",
  name: "Adventure show",
  city: "Austin",
  region: "TX",
  status: "possible",
  probability: "possible",
};

const initialFollowUp: FollowUp = {
  id: "follow-up-1",
  bookingId: initialBooking.id,
  kind: "call",
  dueAt: new Date("2026-08-01T15:00:00Z"),
  completedAt: null,
  outcome: null,
  nextFollowUpId: null,
};

class InMemoryBookingRepository implements BookingRepository {
  public readonly bookings = new Map<string, Booking>();
  public readonly followUps = new Map<string, FollowUp>();
  public readonly auditEntries: AuditEntry[] = [];
  public transactionCount = 0;
  public failAuditWrite = false;
  public beforeTransaction: (() => void) | null = null;
  private nextBookingNumber = 2;
  private nextFollowUpNumber = 2;

  constructor() {
    this.bookings.set(initialBooking.id, { ...initialBooking });
    this.followUps.set(initialFollowUp.id, { ...initialFollowUp });
  }

  async createBooking(input: Omit<Booking, "id">): Promise<Booking> {
    const booking = { ...input, id: `booking-${this.bookings.size + 1}` };
    this.bookings.set(booking.id, booking);
    return booking;
  }

  async transaction<T>(operation: (transaction: BookingTransaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    this.beforeTransaction?.();
    const bookings = new Map(
      [...this.bookings].map(([id, booking]) => [id, { ...booking }]),
    );
    const followUps = new Map(
      [...this.followUps].map(([id, followUp]) => [id, { ...followUp }]),
    );
    const auditEntries = this.auditEntries.map((entry) => ({ ...entry }));
    const transaction = new InMemoryBookingTransaction(
      bookings,
      followUps,
      auditEntries,
      () => `booking-${this.nextBookingNumber++}`,
      () => `follow-up-${this.nextFollowUpNumber++}`,
      () => this.failAuditWrite,
    );

    const result = await operation(transaction);

    this.bookings.clear();
    this.followUps.clear();
    this.auditEntries.length = 0;
    bookings.forEach((booking, id) => this.bookings.set(id, booking));
    followUps.forEach((followUp, id) => this.followUps.set(id, followUp));
    this.auditEntries.push(...auditEntries);

    return result;
  }
}

class InMemoryBookingTransaction implements BookingTransaction {
  constructor(
    private readonly bookings: Map<string, Booking>,
    private readonly followUps: Map<string, FollowUp>,
    private readonly auditEntries: AuditEntry[],
    private readonly nextBookingId: () => string,
    private readonly nextFollowUpId: () => string,
    private readonly shouldFailAuditWrite: () => boolean,
  ) {}

  async createBooking(input: Omit<Booking, "id">): Promise<Booking> {
    const booking = { ...input, id: this.nextBookingId() };
    this.bookings.set(booking.id, booking);
    return booking;
  }

  async findFollowUpWithBookingForUpdate(followUpId: string) {
    const followUp = this.followUps.get(followUpId);
    if (!followUp) return null;
    const booking = this.bookings.get(followUp.bookingId);
    if (!booking) throw new Error("Fixture is missing the follow-up booking.");
    return { followUp: { ...followUp }, booking: { ...booking } };
  }

  async completeFollowUp(
    followUpId: string,
    input: { outcome: string; completedAt: Date },
  ): Promise<FollowUp> {
    const followUp = this.followUps.get(followUpId);
    if (!followUp) throw new Error("Follow-up is missing.");
    const completed = { ...followUp, ...input };
    this.followUps.set(followUp.id, completed);
    return completed;
  }

  async createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {
    const followUp: FollowUp = {
      id: this.nextFollowUpId(),
      bookingId: input.bookingId,
      kind: input.kind,
      dueAt: input.dueAt,
      completedAt: null,
      outcome: null,
      nextFollowUpId: null,
    };
    this.followUps.set(followUp.id, followUp);
    return followUp;
  }

  async linkNextFollowUp(followUpId: string, nextFollowUpId: string): Promise<void> {
    const followUp = this.followUps.get(followUpId);
    if (!followUp) throw new Error("Follow-up is missing.");
    this.followUps.set(followUpId, { ...followUp, nextFollowUpId });
  }

  async updateBookingStatus(input: UpdateBookingStatusInput): Promise<Booking> {
    const booking = this.bookings.get(input.bookingId);
    if (!booking) throw new Error("Booking is missing.");
    const updated = { ...booking, status: input.status };
    this.bookings.set(updated.id, updated);
    return updated;
  }

  async createAuditEntry(input: AuditEntry): Promise<void> {
    if (this.shouldFailAuditWrite()) throw new Error("Audit storage is unavailable.");
    this.auditEntries.push(input);
  }
}

describe("BookingService.completeFollowUp", () => {
  it("audits the locked state immediately before the mutation", async () => {
    const repository = new InMemoryBookingRepository();
    repository.beforeTransaction = () => {
      repository.bookings.set(initialBooking.id, {
        ...initialBooking,
        status: "interested",
      });
      repository.followUps.set(initialFollowUp.id, {
        ...initialFollowUp,
        outcome: "newer outcome",
      });
    };
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    await service.completeFollowUp({
      followUpId: initialFollowUp.id,
      outcome: "send_quote",
      status: "quote_sent",
      nextAction: {
        kind: "prepare_quote",
        dueAt: new Date("2026-08-02T15:00:00Z"),
      },
    });

    expect(repository.auditEntries).toEqual([
      expect.objectContaining({
        entityType: "booking",
        before: { status: "interested" },
      }),
      expect.objectContaining({
        entityType: "follow_up",
        before: {
          completedAt: null,
          outcome: "newer outcome",
          nextFollowUpId: null,
        },
      }),
    ]);
  });

  it("rejects completing an active lead call without a next action", async () => {
    const repository = new InMemoryBookingRepository();
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    const result = await service.completeFollowUp({
      followUpId: initialFollowUp.id,
      outcome: "interested",
      nextAction: null,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "NEXT_ACTION_REQUIRED" },
    });
    expect(repository.transactionCount).toBe(1);
    expect(repository.followUps.get(initialFollowUp.id)?.completedAt).toBeNull();
    expect(repository.auditEntries).toHaveLength(0);
  });

  it("atomically completes the call and schedules its next action", async () => {
    const repository = new InMemoryBookingRepository();
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    const result = await service.completeFollowUp({
      followUpId: initialFollowUp.id,
      outcome: "send_quote",
      status: "quote_sent",
      nextAction: {
        kind: "prepare_quote",
        dueAt: new Date("2026-08-02T15:00:00Z"),
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        ...initialFollowUp,
        completedAt: new Date("2026-08-01T16:00:00Z"),
        outcome: "send_quote",
        nextFollowUpId: "follow-up-2",
      },
    });
    expect(repository.bookings.get(initialBooking.id)?.status).toBe("quote_sent");
    expect(repository.followUps.get("follow-up-2")).toEqual({
      id: "follow-up-2",
      bookingId: initialBooking.id,
      kind: "prepare_quote",
      dueAt: new Date("2026-08-02T15:00:00Z"),
      completedAt: null,
      outcome: null,
      nextFollowUpId: null,
    });
    expect(repository.auditEntries).toEqual([
      {
        entityType: "booking",
        entityId: initialBooking.id,
        action: "update",
        before: { status: "possible" },
        after: { status: "quote_sent" },
      },
      {
        entityType: "follow_up",
        entityId: initialFollowUp.id,
        action: "completed",
        before: { completedAt: null, outcome: null, nextFollowUpId: null },
        after: {
          completedAt: new Date("2026-08-01T16:00:00Z").toISOString(),
          outcome: "send_quote",
          nextFollowUpId: "follow-up-2",
        },
      },
    ]);
  });

  it("allows a resulting closed booking to complete without a next action", async () => {
    const repository = new InMemoryBookingRepository();
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    const result = await service.completeFollowUp({
      followUpId: initialFollowUp.id,
      outcome: "declined",
      status: "declined",
      nextAction: null,
    });

    expect(result.ok).toBe(true);
    expect(repository.bookings.get(initialBooking.id)?.status).toBe("declined");
    expect(repository.followUps.get(initialFollowUp.id)?.completedAt).toEqual(
      new Date("2026-08-01T16:00:00Z"),
    );
  });

  it("rolls back the completion, status update, and next action when the audit write fails", async () => {
    const repository = new InMemoryBookingRepository();
    repository.failAuditWrite = true;
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    await expect(
      service.completeFollowUp({
        followUpId: initialFollowUp.id,
        outcome: "send_quote",
        status: "quote_sent",
        nextAction: {
          kind: "prepare_quote",
          dueAt: new Date("2026-08-02T15:00:00Z"),
        },
      }),
    ).rejects.toThrow("Audit storage is unavailable.");

    expect(repository.bookings.get(initialBooking.id)).toEqual(initialBooking);
    expect(repository.followUps.get(initialFollowUp.id)).toEqual(initialFollowUp);
    expect(repository.followUps.has("follow-up-2")).toBe(false);
    expect(repository.auditEntries).toHaveLength(0);
  });
});

describe("BookingService.createBooking", () => {
  it("atomically creates an active booking with its future next action", async () => {
    const repository = new InMemoryBookingRepository();
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    const booking = await service.createBooking({
      name: "New adventure",
      city: "Dallas",
      region: "TX",
      status: "new_lead",
      probability: "possible",
      nextAction: {
        kind: "call",
        dueAt: new Date("2026-08-02T15:00:00Z"),
      },
    });

    expect(booking).toEqual({
      id: "booking-2",
      name: "New adventure",
      city: "Dallas",
      region: "TX",
      status: "new_lead",
      probability: "possible",
    });
    expect(repository.followUps.get("follow-up-2")).toEqual({
      id: "follow-up-2",
      bookingId: booking.id,
      kind: "call",
      dueAt: new Date("2026-08-02T15:00:00Z"),
      completedAt: null,
      outcome: null,
      nextFollowUpId: null,
    });
  });

  it("rejects an active booking without a future next action", async () => {
    const repository = new InMemoryBookingRepository();
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    await expect(
      service.createBooking({
        name: "New adventure",
        city: "Dallas",
        region: "TX",
        status: "new_lead",
        probability: "possible",
        nextAction: { kind: "call", dueAt: new Date("2026-08-01T16:00:00Z") },
      }),
    ).rejects.toThrow("NEXT_ACTION_REQUIRED");

    expect(repository.bookings.has("booking-2")).toBe(false);
    expect(repository.followUps.has("follow-up-2")).toBe(false);
  });

  it("rejects an active booking without a next action", async () => {
    const repository = new InMemoryBookingRepository();
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    await expect(
      service.createBooking({
        name: "New adventure",
        city: "Dallas",
        region: "TX",
        status: "new_lead",
        probability: "possible",
      }),
    ).rejects.toThrow("NEXT_ACTION_REQUIRED");

    expect(repository.transactionCount).toBe(0);
    expect(repository.bookings.has("booking-2")).toBe(false);
  });

  it("allows a closed booking without a next action", async () => {
    const repository = new InMemoryBookingRepository();
    const service = new BookingService(repository, {
      now: () => new Date("2026-08-01T16:00:00Z"),
    });

    const booking = await service.createBooking({
      name: "Closed adventure",
      city: "Dallas",
      region: "TX",
      status: "declined",
      probability: "unlikely",
    });

    expect(booking.status).toBe("declined");
    expect(repository.followUps.has("follow-up-2")).toBe(false);
  });
});
