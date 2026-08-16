import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const familyId = "11111111-1111-4111-8111-111111111111";
const contactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mocks = vi.hoisted(() => ({
  getFamily: vi.fn(), updateWebsite: vi.fn(), listContactCandidates: vi.fn(), attachContact: vi.fn(),
  createAndAttachContact: vi.fn(), updateFamilyContact: vi.fn(), removeFamilyContact: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
vi.mock("@/features/notes/scoped-note-repository", () => ({ ScopedNoteRepository: class {} }));
vi.mock("@/features/event-families/event-family-repository", () => {
  class EventFamilyConflictError extends Error {}
  class EventFamilyNotFoundError extends Error {}
  return {
    EventFamilyConflictError,
    EventFamilyNotFoundError,
    EventFamilyRepository: class {
      getFamily = mocks.getFamily;
      updateWebsite = mocks.updateWebsite;
      listContactCandidates = mocks.listContactCandidates;
      attachContact = mocks.attachContact;
      createAndAttachContact = mocks.createAndAttachContact;
      updateFamilyContact = mocks.updateFamilyContact;
      removeFamilyContact = mocks.removeFamilyContact;
      listFamilies = vi.fn(); listPendingSuggestions = vi.fn(); listAnalysisCandidates = vi.fn(); replacePendingSuggestions = vi.fn();
      approveSuggestion = vi.fn(); dismissSuggestion = vi.fn(); renameFamily = vi.fn(); addMember = vi.fn(); removeMember = vi.fn();
    },
  };
});

import eventFamiliesRouter from "./event-families";
import { EventFamilyConflictError } from "@/features/event-families/event-family-repository";

describe("event family website/contact routes", () => {
  const app = express();
  app.use(express.json());
  app.use(eventFamiliesRouter);

  beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));

  it("updates and clears a family website", async () => {
    mocks.updateWebsite.mockResolvedValue(true);
    await request(app).patch(`/event-families/${familyId}/website`).send({ website: "waterlanternfestival.com" }).expect(200);
    expect(mocks.updateWebsite).toHaveBeenCalledWith(familyId, "waterlanternfestival.com");
    await request(app).patch(`/event-families/${familyId}/website`).send({ website: null }).expect(200);
    expect(mocks.updateWebsite).toHaveBeenLastCalledWith(familyId, null);
  });

  it("searches existing CRM contacts and attaches one", async () => {
    mocks.listContactCandidates.mockResolvedValue([{ id: contactId, name: "Jane Smith", email: "jane@example.com" }]);
    const search = await request(app).get(`/event-families/${familyId}/contact-candidates?q=Jane`).expect(200);
    expect(search.body.contacts[0].name).toBe("Jane Smith");
    expect(mocks.listContactCandidates).toHaveBeenCalledWith(familyId, "Jane");

    mocks.attachContact.mockResolvedValue({ contactId, name: "Jane Smith", role: "Corporate Events", isPrimary: true });
    await request(app).post(`/event-families/${familyId}/contacts`).send({ contactId, role: "Corporate Events", makePrimary: true }).expect(201);
    expect(mocks.attachContact).toHaveBeenCalledWith(familyId, contactId, "Corporate Events", true);
  });

  it("creates and attaches a new CRM contact", async () => {
    mocks.createAndAttachContact.mockResolvedValue({ contactId, name: "Jane Smith", role: "Director", isPrimary: false });
    await request(app).post(`/event-families/${familyId}/contacts/new`).send({ name: "Jane Smith", phone: "701-555-0101", email: "jane@example.com", role: "Director", makePrimary: false }).expect(201);
    expect(mocks.createAndAttachContact).toHaveBeenCalledWith(familyId, expect.objectContaining({ firstName: "Jane", lastName: "Smith", role: "Director", makePrimary: false }));
  });

  it("updates family role/Primary and removes only the relationship", async () => {
    mocks.updateFamilyContact.mockResolvedValue({ contactId, name: "Jane Smith", role: "National Sales", isPrimary: true });
    await request(app).patch(`/event-families/${familyId}/contacts/${contactId}`).send({ role: "National Sales", isPrimary: true }).expect(200);
    expect(mocks.updateFamilyContact).toHaveBeenCalledWith(familyId, contactId, { role: "National Sales", isPrimary: true });

    mocks.removeFamilyContact.mockResolvedValue(true);
    await request(app).delete(`/event-families/${familyId}/contacts/${contactId}`).expect(200);
    expect(mocks.removeFamilyContact).toHaveBeenCalledWith(familyId, contactId);
  });

  it("maps duplicate links to 409 and validates ids/search length", async () => {
    mocks.attachContact.mockRejectedValue(new EventFamilyConflictError("Contact is already attached to this event family"));
    await request(app).post(`/event-families/${familyId}/contacts`).send({ contactId, role: null, makePrimary: false }).expect(409);
    await request(app).patch(`/event-families/not-a-uuid/website`).send({ website: "example.com" }).expect(400);
    await request(app).get(`/event-families/${familyId}/contact-candidates?q=${"x".repeat(201)}`).expect(400);
  });
});
