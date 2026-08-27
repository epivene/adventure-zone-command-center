import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createdContactId = "11111111-1111-4111-8111-111111111111";
const createContactMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/contacts/contact-repository", () => ({
  DrizzleContactRepository: class {
    createContact(input: unknown) {
      return createContactMock(input);
    }
  },
}));
vi.mock("@/features/activities/activity-repository", () => ({
  DrizzleActivityRepository: class {},
}));
vi.mock("@/features/activities/activity-service", () => ({
  ActivityService: class {},
}));
vi.mock("@/features/contact-phones/contact-phone-repository", () => ({
  createContactPhoneRepository: vi.fn(),
}));

import contactsRouter from "./contacts";

describe("POST /contacts", () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: logErrorMock };
    next();
  });
  app.use(contactsRouter);

  beforeEach(() => {
    createContactMock.mockReset().mockResolvedValue(createdContactId);
    logErrorMock.mockReset();
  });

  it("returns the repository's string id to the caller", async () => {
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
    });

    expect(createContactMock).toHaveBeenCalledOnce();
    expect(logErrorMock).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true, contactId: createdContactId });
  });
});
