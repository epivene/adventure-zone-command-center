import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import * as schema from "@/db/schema";
import {
  activities,
  auditEntries,
  bookingContacts,
  bookings,
  contacts,
  followUps,
  organizationContacts,
  organizations,
  websiteInquiries,
} from "@/db/schema";
import { recordAuditEntry, type AuditChange } from "../audit/audit-service";
import type { WebsiteInquiryActor } from "./website-inquiry-authorization";
import { nextDenverBusinessDayAtNine } from "./next-business-day";

const optionalEmail = z.string().trim().email().max(320).optional();
export const websiteInquiryConversionSchema = z
  .object({
    contact: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), id: z.string().uuid() }).strict(),
      z
        .object({
          mode: z.literal("create"),
          firstName: z.string().trim().min(1).max(100),
          lastName: z.string().trim().min(1).max(100),
          email: optionalEmail,
        })
        .strict(),
    ]),
    organization: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), id: z.string().uuid() }).strict(),
      z
        .object({
          mode: z.literal("create"),
          name: z.string().trim().min(1).max(240),
          city: z.string().trim().min(1).max(120).optional(),
          region: z.string().regex(/^[A-Z]{2}$/).optional(),
        })
        .strict(),
    ]),
    booking: z
      .object({
        name: z.string().trim().min(1).max(240),
        city: z.string().trim().min(1).max(120),
        region: z.string().regex(/^[A-Z]{2}$/),
        startsAt: z.string().datetime({ offset: true }).optional(),
        packageInterest: z.string().trim().max(160).optional(),
        notes: z.string().trim().max(5000).optional(),
      })
      .strict(),
    nextAction: z
      .object({
        kind: z.literal("call"),
        dueAt: z.string().datetime({ offset: true }).optional(),
      })
      .strict(),
  })
  .strict();

export type WebsiteInquiryConversionInput = z.infer<
  typeof websiteInquiryConversionSchema
>;

type ConversionInquiry = {
  id: string;
  status: "new" | "reviewing" | "converted" | "archived" | "spam";
  referenceCode: string;
  eventName: string;
  packageInterest: string | null;
  message: string;
  convertedContactId: string | null;
  convertedOrganizationId: string | null;
  convertedBookingId: string | null;
};

export interface WebsiteInquiryConversionTransaction {
  getInquiryForUpdate(id: string): Promise<ConversionInquiry | null>;
  findExistingConversionFollowUp(bookingId: string): Promise<string | null>;
  findContact(id: string): Promise<{ id: string } | null>;
  findOrganization(id: string): Promise<{ id: string } | null>;
  createOrganization(input: {
    name: string;
    city: string | null;
    region: string | null;
    now: Date;
  }): Promise<{ id: string }>;
  createContact(input: {
    firstName: string;
    lastName: string;
    email: string | null;
    organizationId: null;
    now: Date;
  }): Promise<{ id: string }>;
  ensureOrganizationContact(input: {
    organizationId: string;
    contactId: string;
    now: Date;
  }): Promise<void>;
  setContactPrimaryOrganization(input: {
    contactId: string;
    organizationId: string;
    now: Date;
  }): Promise<void>;
  createBooking(input: {
    organizationId: string;
    primaryContactId: null;
    name: string;
    city: string;
    region: string;
    startsAt: Date | null;
    status: "new_lead";
    probability: "possible";
    packageInterest: string | null;
    notes: string | null;
    now: Date;
  }): Promise<{ id: string }>;
  ensureBookingContact(input: {
    bookingId: string;
    contactId: string;
    isPrimary: true;
    now: Date;
  }): Promise<void>;
  setBookingPrimaryContact(input: {
    bookingId: string;
    contactId: string;
    now: Date;
  }): Promise<void>;
  createFollowUp(input: {
    bookingId: string;
    organizationId: string;
    contactId: string;
    kind: "call";
    dueAt: Date;
    now: Date;
  }): Promise<{ id: string }>;
  createActivity(input: {
    bookingId: string;
    organizationId: string;
    contactId: string;
    kind: "note";
    subject: string;
    body: string;
    now: Date;
  }): Promise<{ id: string }>;
  markConverted(input: {
    inquiryId: string;
    contactId: string;
    organizationId: string;
    bookingId: string;
    now: Date;
  }): Promise<void>;
  recordAuditEntry(change: AuditChange): Promise<void>;
}

export interface WebsiteInquiryConversionRepository {
  runTransaction<T>(
    operation: (transaction: WebsiteInquiryConversionTransaction) => Promise<T>,
  ): Promise<T>;
}

export class WebsiteInquiryConversionNotFoundError extends Error {
  constructor(message = "The selected inquiry or CRM record was not found.") {
    super(message);
    this.name = "WebsiteInquiryConversionNotFoundError";
  }
}

export class WebsiteInquiryConversionStatusError extends Error {
  constructor() {
    super("This inquiry cannot be converted from its current status.");
    this.name = "WebsiteInquiryConversionStatusError";
  }
}

export type WebsiteInquiryConversionResult = {
  inquiryId: string;
  contactId: string;
  organizationId: string;
  bookingId: string;
  followUpId: string;
  alreadyConverted: boolean;
};

export class WebsiteInquiryConversionService {
  constructor(
    private readonly dependencies: {
      repository: WebsiteInquiryConversionRepository;
      now?: () => Date;
    },
  ) {}

  convert(input: {
    inquiryId: string;
    input: WebsiteInquiryConversionInput;
    actor: WebsiteInquiryActor;
  }): Promise<WebsiteInquiryConversionResult> {
    const now = this.dependencies.now?.() ?? new Date();
    return this.dependencies.repository.runTransaction(async (transaction) => {
      const inquiry = await transaction.getInquiryForUpdate(input.inquiryId);
      if (!inquiry) throw new WebsiteInquiryConversionNotFoundError();
      if (inquiry.status === "converted") {
        if (
          !inquiry.convertedContactId ||
          !inquiry.convertedOrganizationId ||
          !inquiry.convertedBookingId
        ) {
          throw new Error("Stored website inquiry conversion is incomplete.");
        }
        const followUpId = await transaction.findExistingConversionFollowUp(
          inquiry.convertedBookingId,
        );
        if (!followUpId) {
          throw new Error("Stored website inquiry follow-up is missing.");
        }
        return {
          inquiryId: inquiry.id,
          contactId: inquiry.convertedContactId,
          organizationId: inquiry.convertedOrganizationId,
          bookingId: inquiry.convertedBookingId,
          followUpId,
          alreadyConverted: true,
        };
      }
      if (inquiry.status !== "new" && inquiry.status !== "reviewing") {
        throw new WebsiteInquiryConversionStatusError();
      }

      let organizationId: string;
      if (input.input.organization.mode === "existing") {
        const organization = await transaction.findOrganization(
          input.input.organization.id,
        );
        if (!organization) {
          throw new WebsiteInquiryConversionNotFoundError(
            "The selected organization was not found.",
          );
        }
        organizationId = organization.id;
      } else {
        organizationId = (
          await transaction.createOrganization({
            name: input.input.organization.name,
            city: input.input.organization.city ?? null,
            region: input.input.organization.region ?? null,
            now,
          })
        ).id;
      }

      let contactId: string;
      if (input.input.contact.mode === "existing") {
        const contact = await transaction.findContact(input.input.contact.id);
        if (!contact) {
          throw new WebsiteInquiryConversionNotFoundError(
            "The selected contact was not found.",
          );
        }
        contactId = contact.id;
      } else {
        contactId = (
          await transaction.createContact({
            firstName: input.input.contact.firstName,
            lastName: input.input.contact.lastName,
            email: input.input.contact.email ?? null,
            organizationId: null,
            now,
          })
        ).id;
      }

      await transaction.ensureOrganizationContact({
        organizationId,
        contactId,
        now,
      });
      await transaction.setContactPrimaryOrganization({
        contactId,
        organizationId,
        now,
      });

      const bookingId = (
        await transaction.createBooking({
          organizationId,
          primaryContactId: null,
          name: input.input.booking.name,
          city: input.input.booking.city,
          region: input.input.booking.region,
          startsAt: input.input.booking.startsAt
            ? new Date(input.input.booking.startsAt)
            : null,
          status: "new_lead",
          probability: "possible",
          packageInterest: input.input.booking.packageInterest ?? null,
          notes: input.input.booking.notes ?? null,
          now,
        })
      ).id;
      await transaction.ensureBookingContact({
        bookingId,
        contactId,
        isPrimary: true,
        now,
      });
      await transaction.setBookingPrimaryContact({ bookingId, contactId, now });

      const followUpId = (
        await transaction.createFollowUp({
          bookingId,
          organizationId,
          contactId,
          kind: "call",
          dueAt: input.input.nextAction.dueAt
            ? new Date(input.input.nextAction.dueAt)
            : nextDenverBusinessDayAtNine(now),
          now,
        })
      ).id;
      const activityId = (
        await transaction.createActivity({
          bookingId,
          organizationId,
          contactId,
          kind: "note",
          subject: `Website inquiry ${inquiry.referenceCode}`,
          body: [
            `Website inquiry: ${inquiry.referenceCode}`,
            `Event: ${inquiry.eventName}`,
            `Package interest: ${
              input.input.booking.packageInterest ??
              inquiry.packageInterest ??
              "Not provided"
            }`,
            "",
            inquiry.message,
          ].join("\n"),
          now,
        })
      ).id;
      await transaction.markConverted({
        inquiryId: input.inquiryId,
        contactId,
        organizationId,
        bookingId,
        now,
      });
      await transaction.recordAuditEntry({
        entityType: "website_inquiry",
        entityId: input.inquiryId,
        action: "convert",
        before: { status: inquiry.status },
        after: {
          status: "converted",
          actor: input.actor,
          contactId,
          organizationId,
          bookingId,
          followUpId,
          activityId,
        },
      });
      return {
        inquiryId: input.inquiryId,
        contactId,
        organizationId,
        bookingId,
        followUpId,
        alreadyConverted: false,
      };
    });
  }
}

export class DrizzleWebsiteInquiryConversionRepository
  implements WebsiteInquiryConversionRepository
{
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  runTransaction<T>(
    operation: (transaction: WebsiteInquiryConversionTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) =>
      operation({
        getInquiryForUpdate: async (id) => {
          const [inquiry] = await transaction
            .select({
              id: websiteInquiries.id,
              status: websiteInquiries.status,
              referenceCode: websiteInquiries.referenceCode,
              eventName: websiteInquiries.eventName,
              packageInterest: websiteInquiries.packageInterest,
              message: websiteInquiries.message,
              convertedContactId: websiteInquiries.convertedContactId,
              convertedOrganizationId: websiteInquiries.convertedOrganizationId,
              convertedBookingId: websiteInquiries.convertedBookingId,
            })
            .from(websiteInquiries)
            .where(eq(websiteInquiries.id, id))
            .limit(1)
            .for("update");
          return inquiry ?? null;
        },
        findExistingConversionFollowUp: async (bookingId) => {
          const [followUp] = await transaction
            .select({ id: followUps.id })
            .from(followUps)
            .where(
              and(
                eq(followUps.bookingId, bookingId),
                eq(followUps.kind, "call"),
              ),
            )
            .orderBy(asc(followUps.createdAt))
            .limit(1);
          return followUp?.id ?? null;
        },
        findContact: async (id) => {
          const [contact] = await transaction
            .select({ id: contacts.id })
            .from(contacts)
            .where(eq(contacts.id, id))
            .limit(1);
          return contact ?? null;
        },
        findOrganization: async (id) => {
          const [organization] = await transaction
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, id))
            .limit(1);
          return organization ?? null;
        },
        createOrganization: async (input) => {
          const [created] = await transaction
            .insert(organizations)
            .values({
              name: input.name,
              city: input.city,
              region: input.region,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning({ id: organizations.id });
          if (!created) throw new Error("Organization was not created.");
          return created;
        },
        createContact: async (input) => {
          const [created] = await transaction
            .insert(contacts)
            .values({
              firstName: input.firstName,
              lastName: input.lastName,
              email: input.email,
              organizationId: input.organizationId,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning({ id: contacts.id });
          if (!created) throw new Error("Contact was not created.");
          return created;
        },
        ensureOrganizationContact: async (input) => {
          await transaction
            .insert(organizationContacts)
            .values({
              organizationId: input.organizationId,
              contactId: input.contactId,
              active: true,
              source: "local",
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [
                organizationContacts.organizationId,
                organizationContacts.contactId,
              ],
            });
        },
        setContactPrimaryOrganization: async (input) => {
          await transaction
            .update(contacts)
            .set({ organizationId: input.organizationId, updatedAt: input.now })
            .where(eq(contacts.id, input.contactId));
        },
        createBooking: async (input) => {
          const notes = [
            input.notes,
            input.packageInterest
              ? `Package interest: ${input.packageInterest}`
              : null,
          ]
            .filter(Boolean)
            .join("\n\n") || null;
          const [created] = await transaction
            .insert(bookings)
            .values({
              organizationId: input.organizationId,
              primaryContactId: input.primaryContactId,
              name: input.name,
              city: input.city,
              region: input.region,
              startsAt: input.startsAt,
              status: input.status,
              probability: input.probability,
              notes,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning({ id: bookings.id });
          if (!created) throw new Error("Booking was not created.");
          return created;
        },
        ensureBookingContact: async (input) => {
          await transaction
            .insert(bookingContacts)
            .values({
              bookingId: input.bookingId,
              contactId: input.contactId,
              isPrimary: input.isPrimary,
              source: "local",
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [bookingContacts.bookingId, bookingContacts.contactId],
            });
        },
        setBookingPrimaryContact: async (input) => {
          await transaction
            .update(bookings)
            .set({ primaryContactId: input.contactId, updatedAt: input.now })
            .where(eq(bookings.id, input.bookingId));
        },
        createFollowUp: async (input) => {
          const [created] = await transaction
            .insert(followUps)
            .values({
              bookingId: input.bookingId,
              organizationId: input.organizationId,
              contactId: input.contactId,
              kind: input.kind,
              dueAt: input.dueAt,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning({ id: followUps.id });
          if (!created) throw new Error("Follow-up was not created.");
          return created;
        },
        createActivity: async (input) => {
          const [created] = await transaction
            .insert(activities)
            .values({
              bookingId: input.bookingId,
              organizationId: input.organizationId,
              contactId: input.contactId,
              kind: input.kind,
              subject: input.subject,
              body: input.body,
              occurredAt: input.now,
              timelineSortAt: input.now,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning({ id: activities.id });
          if (!created) throw new Error("Inquiry activity was not created.");
          return created;
        },
        markConverted: async (input) => {
          await transaction
            .update(websiteInquiries)
            .set({
              status: "converted",
              convertedContactId: input.contactId,
              convertedOrganizationId: input.organizationId,
              convertedBookingId: input.bookingId,
              convertedAt: input.now,
              updatedAt: input.now,
            })
            .where(eq(websiteInquiries.id, input.inquiryId));
        },
        recordAuditEntry: (change) => recordAuditEntry(transaction, change),
      }),
    );
  }
}
