import { describe, expect, it, vi } from "vitest";

import {
  WebsiteInquiryConversionNotFoundError,
  WebsiteInquiryConversionService,
  WebsiteInquiryConversionStatusError,
  type WebsiteInquiryConversionRepository,
  type WebsiteInquiryConversionTransaction,
  websiteInquiryConversionSchema,
} from "./website-inquiry-conversion";

const inquiryId = "20000000-0000-4000-8000-000000000002";
const actor = { kind: "office", id: "amy-id", name: "Amy" } as const;
const now = new Date("2026-09-03T18:00:00.000Z");
const ids = {
  contactId: "10000000-0000-4000-8000-000000000001",
  organizationId: "30000000-0000-4000-8000-000000000001",
  bookingId: "40000000-0000-4000-8000-000000000001",
  followUpId: "50000000-0000-4000-8000-000000000001",
  activityId: "60000000-0000-4000-8000-000000000001",
};
const input = {
  contact: {
    mode: "create" as const,
    firstName: "Desie",
    lastName: "Example",
    email: "desie@example.com",
  },
  organization: {
    mode: "create" as const,
    name: "Summer Festival",
    city: "Denver",
    region: "CO",
  },
  booking: {
    name: "Summer Festival 2027",
    city: "Denver",
    region: "CO",
    startsAt: "2027-07-04T16:00:00.000Z",
    packageInterest: "Adventure Zone",
    notes: "Website lead",
  },
  nextAction: { kind: "call" as const },
};

function inquiry(status: "new" | "reviewing" | "converted" | "archived" | "spam" = "new") {
  return {
    id: inquiryId,
    status,
    referenceCode: "AZI-2026-AAAAAAAA",
    eventName: "Summer Festival",
    packageInterest: "Adventure Zone",
    message: "Please send availability.",
    convertedContactId: status === "converted" ? ids.contactId : null,
    convertedOrganizationId: status === "converted" ? ids.organizationId : null,
    convertedBookingId: status === "converted" ? ids.bookingId : null,
  };
}

function setup(status: "new" | "reviewing" | "converted" | "archived" | "spam" = "new") {
  const transaction: WebsiteInquiryConversionTransaction = {
    getInquiryForUpdate: vi.fn(async () => inquiry(status)),
    findExistingConversionFollowUp: vi.fn(async () => ids.followUpId),
    findContact: vi.fn(async () => ({ id: ids.contactId })),
    findOrganization: vi.fn(async () => ({ id: ids.organizationId })),
    createOrganization: vi.fn(async () => ({ id: ids.organizationId })),
    createContact: vi.fn(async () => ({ id: ids.contactId })),
    ensureOrganizationContact: vi.fn(async () => undefined),
    setContactPrimaryOrganization: vi.fn(async () => undefined),
    createBooking: vi.fn(async () => ({ id: ids.bookingId })),
    ensureBookingContact: vi.fn(async () => undefined),
    setBookingPrimaryContact: vi.fn(async () => undefined),
    createFollowUp: vi.fn(async () => ({ id: ids.followUpId })),
    createActivity: vi.fn(async () => ({ id: ids.activityId })),
    markConverted: vi.fn(async () => undefined),
    recordAuditEntry: vi.fn(async () => undefined),
  };
  const repository: WebsiteInquiryConversionRepository = {
    runTransaction: vi.fn(async (operation) => operation(transaction)),
  };
  const service = new WebsiteInquiryConversionService({
    repository,
    now: () => now,
  });
  return { repository, service, transaction };
}

describe("website inquiry conversion schema", () => {
  it("accepts the strict discriminated create/existing contract", () => {
    expect(websiteInquiryConversionSchema.safeParse(input).success).toBe(true);
    expect(
      websiteInquiryConversionSchema.safeParse({
        ...input,
        contact: { mode: "existing", id: ids.contactId },
        organization: { mode: "existing", id: ids.organizationId },
      }).success,
    ).toBe(true);
  });

  it.each([
    { ...input, booking: { name: "Event", region: "CO" } },
    { ...input, booking: { name: "Event", city: "Denver" } },
    { ...input, booking: { ...input.booking, region: "Colorado" } },
    { ...input, role: "owner" },
  ])("rejects incomplete, invalid, or unknown conversion fields", (value) => {
    expect(websiteInquiryConversionSchema.safeParse(value).success).toBe(false);
  });
});

describe("WebsiteInquiryConversionService", () => {
  it("returns the committed conversion immediately when retried", async () => {
    const h = setup("converted");
    await expect(h.service.convert({ inquiryId, input, actor })).resolves.toEqual({
      inquiryId,
      contactId: ids.contactId,
      organizationId: ids.organizationId,
      bookingId: ids.bookingId,
      followUpId: ids.followUpId,
      alreadyConverted: true,
    });
    expect(h.transaction.findExistingConversionFollowUp).toHaveBeenCalledWith(
      ids.bookingId,
    );
    expect(h.transaction.findContact).not.toHaveBeenCalled();
    expect(h.transaction.createOrganization).not.toHaveBeenCalled();
  });

  it.each(["archived", "spam"] as const)(
    "rejects a %s inquiry without CRM writes",
    async (status) => {
      const h = setup(status);
      await expect(
        h.service.convert({ inquiryId, input, actor }),
      ).rejects.toBeInstanceOf(WebsiteInquiryConversionStatusError);
      expect(h.transaction.createBooking).not.toHaveBeenCalled();
    },
  );

  it("verifies selected existing contact and organization IDs", async () => {
    const h = setup();
    vi.mocked(h.transaction.findContact).mockResolvedValueOnce(null);
    await expect(
      h.service.convert({
        inquiryId,
        input: {
          ...input,
          contact: { mode: "existing", id: ids.contactId },
          organization: { mode: "existing", id: ids.organizationId },
        },
        actor,
      }),
    ).rejects.toBeInstanceOf(WebsiteInquiryConversionNotFoundError);
    expect(h.transaction.createBooking).not.toHaveBeenCalled();
  });

  it("creates the relationships, lead, default call, note, conversion marker, and audit", async () => {
    const h = setup("reviewing");
    await expect(
      h.service.convert({ inquiryId, input, actor }),
    ).resolves.toEqual({
      inquiryId,
      contactId: ids.contactId,
      organizationId: ids.organizationId,
      bookingId: ids.bookingId,
      followUpId: ids.followUpId,
      alreadyConverted: false,
    });

    expect(h.transaction.createOrganization).toHaveBeenCalledWith({
      name: "Summer Festival",
      city: "Denver",
      region: "CO",
      now,
    });
    expect(h.transaction.createContact).toHaveBeenCalledWith({
      firstName: "Desie",
      lastName: "Example",
      email: "desie@example.com",
      organizationId: null,
      now,
    });
    expect(h.transaction.ensureOrganizationContact).toHaveBeenCalledWith({
      organizationId: ids.organizationId,
      contactId: ids.contactId,
      now,
    });
    expect(h.transaction.setContactPrimaryOrganization).toHaveBeenCalledWith({
      contactId: ids.contactId,
      organizationId: ids.organizationId,
      now,
    });
    expect(h.transaction.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ids.organizationId,
        primaryContactId: null,
        status: "new_lead",
        probability: "possible",
      }),
    );
    expect(h.transaction.ensureBookingContact).toHaveBeenCalledWith({
      bookingId: ids.bookingId,
      contactId: ids.contactId,
      isPrimary: true,
      now,
    });
    expect(h.transaction.createFollowUp).toHaveBeenCalledWith({
      bookingId: ids.bookingId,
      organizationId: ids.organizationId,
      contactId: ids.contactId,
      kind: "call",
      dueAt: new Date("2026-09-04T15:00:00.000Z"),
      now,
    });
    expect(h.transaction.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: ids.bookingId,
        organizationId: ids.organizationId,
        contactId: ids.contactId,
        kind: "note",
        body: expect.stringMatching(
          /AZI-2026-AAAAAAAA[\s\S]*Adventure Zone[\s\S]*Please send availability\./,
        ),
      }),
    );
    expect(h.transaction.markConverted).toHaveBeenCalledWith({
      inquiryId,
      contactId: ids.contactId,
      organizationId: ids.organizationId,
      bookingId: ids.bookingId,
      now,
    });
    expect(h.transaction.recordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "website_inquiry",
        entityId: inquiryId,
        action: "convert",
        after: expect.objectContaining({ actor, ...ids }),
      }),
    );
  });

  it("uses an explicit call due time when supplied", async () => {
    const h = setup();
    const dueAt = "2026-09-10T17:30:00.000Z";
    await h.service.convert({
      inquiryId,
      input: { ...input, nextAction: { kind: "call", dueAt } },
      actor,
    });
    expect(h.transaction.createFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ dueAt: new Date(dueAt) }),
    );
  });

  it("does not mark or audit a conversion after an earlier write fails", async () => {
    const h = setup();
    vi.mocked(h.transaction.createActivity).mockRejectedValueOnce(
      new Error("activity failed"),
    );
    await expect(
      h.service.convert({ inquiryId, input, actor }),
    ).rejects.toThrow("activity failed");
    expect(h.transaction.markConverted).not.toHaveBeenCalled();
    expect(h.transaction.recordAuditEntry).not.toHaveBeenCalled();
  });
});
