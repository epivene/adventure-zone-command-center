import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  getContactDetail: vi.fn(),
  updateContact: vi.fn(),
  replaceForContact: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    transaction: vi.fn(async (work: (transaction: object) => unknown) => work({})),
  },
  pool: {},
}));
vi.mock("./google-workspace-profile-email", () => ({
  createGoogleWorkspaceProfileEmailRouter: () => express.Router(),
}));
vi.mock("@/features/boss/boss-account-repository", () => ({
  DrizzleBossAccountRepository: class {},
}));
vi.mock("@/features/boss/boss-middleware", () => ({
  createRequireBossMiddleware: () => (req: any, _res: any, next: any) => {
    req.bossAccount = { accountId: "boss-1", displayName: "Dave" };
    next();
  },
}));
vi.mock("@/features/office/office-profile-service", () => ({
  OfficeProfileService: class {},
}));
vi.mock("@/features/office/office-profile-editor", () => ({
  OfficeProfileEditor: class {
    updateProfile = mocks.updateProfile;
  },
}));
vi.mock("@/features/contacts/contact-repository", () => ({
  DrizzleContactRepository: class {
    getContactDetail = mocks.getContactDetail;
    updateContact = mocks.updateContact;
  },
}));
vi.mock("@/features/contact-phones/contact-phone-repository", () => ({
  createContactPhoneRepository: () => ({ replaceForContact: mocks.replaceForContact }),
}));

import bossProfiles from "./boss-profiles";
import bossOperations from "./boss-operations";

const profileId = "10000000-0000-4000-8000-000000000001";
const contactId = "10000000-0000-4000-8000-000000000002";

function app() {
  const instance = express();
  instance.use(express.json(), bossProfiles, bossOperations);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateProfile.mockResolvedValue(true);
  mocks.updateContact.mockResolvedValue(true);
  mocks.replaceForContact.mockResolvedValue([
    { id: "phone-1", number: "701-555-0100", primary: true },
  ]);
  mocks.getContactDetail.mockResolvedValue({
    contact: { id: contactId, firstName: "Sam", lastName: "Taylor" },
    places: [
      { id: profileId, name: "County Fair", active: true, isPrimaryPlace: true },
    ],
    phones: [],
    relatedBookings: [],
  });
});

describe("Dave profile and contact editing", () => {
  it("saves profile changes with the authenticated boss identity", async () => {
    const response = await request(app())
      .patch(`/boss/profiles/${profileId}`)
      .send({ name: "Updated County Fair", city: "Dickinson" });

    expect(response.status).toBe(200);
    expect(mocks.updateProfile).toHaveBeenCalledWith(
      profileId,
      { name: "Updated County Fair", city: "Dickinson" },
      { accountId: "boss-1", displayName: "Dave" },
    );
  });

  it("returns every profile connected to a contact", async () => {
    const response = await request(app()).get(`/boss/contacts/${contactId}`);

    expect(response.status).toBe(200);
    expect(response.body.places).toEqual([
      expect.objectContaining({ id: profileId, name: "County Fair" }),
    ]);
  });

  it("saves contact fields and phone numbers atomically", async () => {
    const response = await request(app())
      .put(`/boss/contacts/${contactId}`)
      .send({
        contact: {
          firstName: "Sam",
          lastName: "Taylor",
          organizationName: "County Fair",
          jobTitle: "Director",
          email: "sam@example.com",
          phone: "701-555-0100",
          address1: "1 Main St",
          address2: "",
          city: "Dickinson",
          region: "ND",
          postalCode: "58601",
        },
        phones: [{ id: null, number: "701-555-0100", type: "office", extension: null, label: null, primary: true }],
      });

    expect(response.status).toBe(200);
    expect(mocks.replaceForContact).toHaveBeenCalledOnce();
    expect(mocks.updateContact).toHaveBeenCalledWith(
      contactId,
      expect.objectContaining({ firstName: "Sam", phone: "701-555-0100" }),
    );
  });
});
