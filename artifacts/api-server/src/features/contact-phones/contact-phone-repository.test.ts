import { describe, expect, it } from "vitest";

import type {
  ContactPhoneInput,
  ContactPhoneRecord,
  ContactPhoneStore,
  LegacyContactPhoneFields,
} from "./contact-phone-repository";
import { ContactPhoneRepository } from "./contact-phone-repository";

const now = new Date("2026-08-12T20:30:00.000Z");
const contactId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

class MemoryContactPhoneStore implements ContactPhoneStore {
  readonly contact: LegacyContactPhoneFields = {
    id: contactId,
    organizationId,
    phone: null,
    normalizedPhone: null,
  };
  readonly organization = { id: organizationId, lastResort: false };
  private nextId = 1;
  private phones: ContactPhoneRecord[] = [];

  transaction<T>(callback: (store: ContactPhoneStore) => Promise<T>) {
    return callback(this);
  }

  async lockContact(id: string) {
    return id === this.contact.id ? { ...this.contact } : null;
  }

  async listForContact(id: string) {
    return this.phones.filter((phone) => phone.contactId === id).map((phone) => ({ ...phone }));
  }

  async insertPhone(input: Omit<ContactPhoneRecord, "id" | "source" | "doNotCallAt" | "doNotCallReason">) {
    const phone: ContactPhoneRecord = {
      ...input,
      id: `phone-${this.nextId++}`,
      source: "local",
      doNotCallAt: null,
      doNotCallReason: null,
    };
    this.phones.push(phone);
    return { ...phone };
  }

  async updatePhone(id: string, input: Pick<ContactPhoneInput, "number" | "type" | "extension" | "label" | "primary"> & {
    normalizedNumber: string | null;
    updatedAt: Date;
  }) {
    const index = this.phones.findIndex((phone) => phone.id === id);
    if (index < 0) throw new Error("Contact phone is missing.");
    this.phones[index] = { ...this.phones[index]!, ...input };
    return { ...this.phones[index]! };
  }

  async deletePhones(ids: string[]) {
    this.phones = this.phones.filter((phone) => !ids.includes(phone.id));
  }

  async updateLegacyContact(id: string, phone: string | null, normalizedPhone: string | null) {
    if (id !== this.contact.id) throw new Error("Contact is missing.");
    this.contact.phone = phone;
    this.contact.normalizedPhone = normalizedPhone;
  }

  async markPhoneDoNotCall(id: string, reason: string, at: Date) {
    const index = this.phones.findIndex((phone) => phone.id === id);
    if (index < 0) throw new Error("Contact phone is missing.");
    this.phones[index] = {
      ...this.phones[index]!,
      doNotCallAt: at,
      doNotCallReason: reason,
    };
    return { ...this.phones[index]! };
  }

  async loadLegacyContact(id: string) {
    return id === this.contact.id ? { ...this.contact } : null;
  }

  async loadOrganization(id: string) {
    return id === this.organization.id ? { ...this.organization } : null;
  }
}

describe("ContactPhoneRepository", () => {
  it("returns the primary phone first and mirrors it to the legacy contact", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);

    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0100", type: "office", extension: "4", label: null, primary: false },
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
    ], now);

    expect(await repository.listForContact(contactId)).toMatchObject([
      { normalizedNumber: "+17015550199", type: "mobile", primary: true },
      { normalizedNumber: "+17015550100", type: "office", extension: "4", primary: false },
    ]);
    expect(await store.loadLegacyContact(contactId)).toMatchObject({
      phone: "701-555-0199",
      normalizedPhone: "+17015550199",
    });
  });

  it("records Do Not Call on one number without marking the organization Last Resort", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);
    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0100", type: "office", extension: null, label: null, primary: true },
    ], now);
    const phoneId = (await repository.listForContact(contactId))[0]!.id;

    await repository.markDoNotCall(phoneId, "Asked not to receive calls", now);

    expect(await repository.listForContact(contactId)).toContainEqual(
      expect.objectContaining({ id: phoneId, doNotCallAt: now }),
    );
    expect(await store.loadOrganization(organizationId)).toMatchObject({ lastResort: false });
  });
});
