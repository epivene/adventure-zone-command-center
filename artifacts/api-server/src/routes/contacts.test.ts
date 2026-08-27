import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const contactId = "11111111-1111-4111-8111-111111111111";
const createContact = vi.hoisted(() => vi.fn());
const updateContact = vi.hoisted(() => vi.fn());
const atomicContact = vi.hoisted(() => ({ firstName: "Ada" }));
const phoneRepository = vi.hoisted(() => {
  const fixtureContactId = "11111111-1111-4111-8111-111111111111";
  let phones = [{
    id: "33333333-3333-4333-8333-333333333333",
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
    replaceForContact: vi.fn(async (requestedContactId: string, next: typeof phones) => {
      if (requestedContactId !== fixtureContactId) throw new Error("Contact is missing.");
      if (next.some((phone) => phone.number === "701-555-0100" && phone.id === "33333333-3333-4333-8333-333333333333")) {
        throw new Error("A suppressed phone number cannot be changed; add a new number to preserve suppression history.");
      }
      phones = next.map((phone) => ({ ...phone, id: phone.id ?? "phone-2", contactId: fixtureContactId }));
      return phones.map((phone) => ({ ...phone }));
    }),
    reset() {
      phones = [{
        id: "33333333-3333-4333-8333-333333333333",
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

vi.mock("@workspace/db", () => ({ db: { transaction: async (callback: (transaction: unknown) => unknown) => {
  const snapshot = { ...atomicContact };
  try { return await callback({}); }
  catch (error) { Object.assign(atomicContact, snapshot); throw error; }
} } }));
vi.mock("@/features/contacts/contact-repository", () => ({
  DrizzleContactRepository: class {
    async createContact(input: unknown) { return createContact(input); }
    async updateContact(id: string, input: unknown) { return updateContact(id, input); }
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
    async listTimeline() { return { items: [], nextPage: null }; }
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
    atomicContact.firstName = "Ada";
    createContact.mockReset().mockResolvedValue(contactId);
    updateContact.mockReset().mockImplementation(async (_id: string, input: { firstName: string }) => {
      atomicContact.firstName = input.firstName;
      return true;
    });
  });

  it("returns the new contact id when the repository returns a string id", async () => {
    const response = await request(app).post("/contacts").send({
      firstName: "Ada",
      lastName: "Lovelace",
      organizationName: "Example Event",
      jobTitle: "Organizer",
      email: "ada@example.com",
      phone: "701-555-0199",
      address1: "",
      address2: "",
      city: "Bismarck",
      region: "ND",
      postalCode: "58501",
    }).expect(201);

    expect(response.body).toEqual({ ok: true, contactId });
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
        { id: null, number: "701-555-0199", type: "mobile", extension: "", label: "", primary: true },
      ],
    }).expect(400);

    expect(await phoneRepository.listForContact(contactId)).toHaveLength(1);
    expect(phoneRepository.replaceForContact).not.toHaveBeenCalled();
  });
  it("replaces phones and returns the saved rows", async () => {
    const response = await request(app).put(`/contacts/${contactId}/phones`).send({
      phones: [
        { id: null, number: "701-555-0100", type: "office", extension: "12", label: "Desk", primary: false },
        { id: "33333333-3333-4333-8333-333333333333", number: "701-555-0199", type: "mobile", extension: "", label: "", primary: true },
      ],
    }).expect(200);

    expect(response.body.phones).toEqual([
      expect.objectContaining({ number: "701-555-0100", type: "office", label: "Desk", primary: false }),
      expect.objectContaining({ number: "701-555-0199", type: "mobile", primary: true }),
    ]);
  });

  it("returns 404 when replacing phones for a missing contact", async () => {
    await request(app).put("/contacts/99999999-9999-4999-8999-999999999999/phones").send({
      phones: [],
    }).expect(404);
  });

  it("returns 400 when a suppressed number is changed in place", async () => {
    await request(app).put(`/contacts/${contactId}/phones`).send({
      phones: [
        { id: "33333333-3333-4333-8333-333333333333", number: "701-555-0100", type: "mobile", extension: "", label: "", primary: true },
      ],
    }).expect(400);
  });

  it("returns an actionable 400 when a replacement duplicates a canonical destination", async () => {
    phoneRepository.replaceForContact.mockRejectedValueOnce(
      new Error("That normalized phone destination already exists for this contact; edit the existing phone instead."),
    );

    const response = await request(app).put(`/contacts/${contactId}/phones`).send({
      phones: [
        { id: "33333333-3333-4333-8333-333333333333", number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
        { id: null, number: "(701) 555-0199", type: "alternate", extension: null, label: null, primary: false },
      ],
    }).expect(400);

    expect(response.body).toEqual({
      ok: false,
      error: "That normalized phone destination already exists for this contact; edit the existing phone instead.",
    });
  });

  it("atomically accepts nullable phone metadata with the contact edit", async () => {
    await request(app).put(`/contacts/${contactId}`).send({
      contact: {
        firstName: "Ada", lastName: "Lovelace", organizationName: "", jobTitle: "",
        email: "", phone: "701-555-0199", address1: "", address2: "", city: "",
        region: "", postalCode: "",
      },
      phones: [{
        id: "33333333-3333-4333-8333-333333333333",
        number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true,
      }],
    }).expect(200);

    expect(updateContact).toHaveBeenCalledOnce();
    expect(phoneRepository.replaceForContact).toHaveBeenCalledWith(
      contactId,
      [expect.objectContaining({ extension: null, label: null })],
      expect.any(Date),
    );
    expect(phoneRepository.replaceForContact.mock.invocationCallOrder[0])
      .toBeLessThan(updateContact.mock.invocationCallOrder[0]!);
  });

  it("returns 400 for suppressed-phone validation without committing contact fields", async () => {
    phoneRepository.replaceForContact.mockRejectedValueOnce(
      new Error("A suppressed phone number cannot be removed; keep it to preserve suppression history."),
    );

    const response = await request(app).put(`/contacts/${contactId}`).send({
      contact: {
        firstName: "Changed", lastName: "Lovelace", organizationName: "", jobTitle: "",
        email: "", phone: "", address1: "", address2: "", city: "", region: "", postalCode: "",
      },
      phones: [],
    }).expect(400);

    expect(response.body.error).toMatch(/suppressed phone number cannot be removed/i);
    expect(updateContact).not.toHaveBeenCalled();
    expect(atomicContact.firstName).toBe("Ada");
  });

});
