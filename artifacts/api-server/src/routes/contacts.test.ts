import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const contactId = "11111111-1111-4111-8111-111111111111";
const phoneRepository = vi.hoisted(() => {
  const fixtureContactId = "11111111-1111-4111-8111-111111111111";
  let phones = [{
    id: "phone-1",
    contactId: fixtureContactId,
    number: "701-555-0199",
    type: "mobile" as const,
    extension: null,
    label: null,
    primary: true,
    normalizedNumber: "+17015550199",
    source: "local",
    doNotCallAt: null,
    doNotCallReason: null,
  }];

  return {
    listForContact: vi.fn(async (_contactId: string) => phones.map((phone) => ({ ...phone }))),
    replaceForContact: vi.fn(async (_contactId: string, next: typeof phones) => {
      phones = next.map((phone) => ({ ...phone, id: phone.id ?? "phone-2", contactId: fixtureContactId }));
      return phones.map((phone) => ({ ...phone }));
    }),
    reset() {
      phones = [{
        id: "phone-1",
        contactId: fixtureContactId,
        number: "701-555-0199",
        type: "mobile",
        extension: null,
        label: null,
        primary: true,
        normalizedNumber: "+17015550199",
        source: "local",
        doNotCallAt: null,
        doNotCallReason: null,
      }];
    },
  };
});

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/contacts/contact-repository", () => ({
  DrizzleContactRepository: class {
    async getContactDetail(id: string) {
      if (id !== contactId) return null;
      return {
        contact: {
          id: contactId,
          firstName: "Ada",
          lastName: "Lovelace",
          organizationName: null,
          jobTitle: null,
          email: null,
          phone: "701-555-0199",
          address1: null,
          address2: null,
          city: null,
          region: null,
          postalCode: null,
          syncState: "unlinked",
          updatedAt: new Date("2026-08-12T00:00:00.000Z"),
          lastSyncedAt: null,
          actRecordId: null,
          createdAt: new Date("2026-08-12T00:00:00.000Z"),
        },
        places: [],
        relatedBookings: [],
        phones: await phoneRepository.listForContact(id),
      };
    }
  },
}));
vi.mock("@/features/activities/activity-repository", () => ({
  DrizzleActivityRepository: class {},
}));
vi.mock("@/features/activities/activity-service", () => ({
  ActivityService: class {
    async listTimeline() { return []; }
  },
}));
vi.mock("@/features/contact-phones/contact-phone-repository", () => ({
  createContactPhoneRepository: () => phoneRepository,
}));

import contactsRouter from "./contacts";

describe("contact phone routes", () => {
  const app = express();
  app.use(express.json());
  app.use(contactsRouter);

  beforeEach(() => {
    phoneRepository.reset();
    phoneRepository.listForContact.mockClear();
    phoneRepository.replaceForContact.mockClear();
  });

  it("returns labeled phones on contact detail", async () => {
    const response = await request(app).get(`/contacts/${contactId}`).expect(200);

    expect(response.body.phones).toEqual([
      expect.objectContaining({ type: "mobile", primary: true, number: "701-555-0199" }),
    ]);
  });

  it("rejects an invalid replacement without changing existing phone rows", async () => {
    await request(app).put(`/contacts/${contactId}/phones`).send({
      phones: [
        { id: null, number: "701-555-0100", type: "office", extension: "12", label: null, primary: true },
        { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
      ],
    }).expect(400);

    expect(await phoneRepository.listForContact(contactId)).toHaveLength(1);
    expect(phoneRepository.replaceForContact).not.toHaveBeenCalled();
  });
});
