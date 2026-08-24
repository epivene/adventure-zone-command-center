import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProfileDraftStore, type ProfileDraft } from "./lib/profile-draft";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const appMenuSource = readFileSync("src/components/navigation/app-menu.tsx", "utf8");

const exampleDraft: ProfileDraft = {
  eventName: "Moab Music Festival",
  description: "Annual community music event",
  phone: "435-259-7003",
  website: "https://example.com",
  address1: "100 Main St",
  address2: "",
  city: "Moab",
  region: "UT",
  postalCode: "84532",
  familyId: "",
  contacts: [{ id: "", name: "Jamie Doe", phone: "", email: "jamie@example.com", role: "Coordinator", primary: true }],
  includeBooking: true,
  bookingName: "2027 Moab Music Festival",
  travelLegId: "",
  nextActionKind: "email",
  nextActionDueAt: "2026-09-01",
  savedAt: "2026-08-24T23:00:00.000Z",
};

describe("profile creation quick actions", () => {
  it("offers add/find actions for profiles and contacts", () => {
    expect(appMenuSource).toContain("Add a New Profile");
    expect(appMenuSource).toContain("Find a Profile");
    expect(appMenuSource).toContain("Add a New Contact");
    expect(appMenuSource).toContain("Find a Contact");
    expect(appMenuSource).not.toContain(">New caller<");
  });
});

describe("new profile draft recovery", () => {
  it("persists and restores an unfinished profile without creating a server record", () => {
    const storage = new MemoryStorage();
    const store = createProfileDraftStore(storage);

    store.save(exampleDraft);

    expect(store.load()).toEqual(exampleDraft);
  });

  it("clears the local draft after a successful save or explicit discard", () => {
    const storage = new MemoryStorage();
    const store = createProfileDraftStore(storage);
    store.save(exampleDraft);

    store.clear();

    expect(store.load()).toBeNull();
  });

  it("ignores corrupt local draft data instead of breaking the form", () => {
    const storage = new MemoryStorage();
    storage.setItem("adventure-zone:new-profile-draft:v1", "not-json");

    expect(createProfileDraftStore(storage).load()).toBeNull();
  });
});
