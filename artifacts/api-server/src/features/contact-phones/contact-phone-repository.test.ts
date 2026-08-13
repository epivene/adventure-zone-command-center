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

  async transaction<T>(callback: (store: ContactPhoneStore) => Promise<T>) {
    const transaction = Object.create(this) as MemoryContactPhoneStore;
    (transaction as unknown as { phones: ContactPhoneRecord[] }).phones = this.phones.map((phone) => ({ ...phone }));
    (transaction as unknown as { contact: LegacyContactPhoneFields }).contact = { ...this.contact };
    (transaction as unknown as { nextId: number }).nextId = this.nextId;
    const result = await callback(transaction);
    this.phones = (transaction as unknown as { phones: ContactPhoneRecord[] }).phones;
    this.nextId = (transaction as unknown as { nextId: number }).nextId;
    Object.assign(this.contact, (transaction as unknown as { contact: LegacyContactPhoneFields }).contact);
    return result;
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
    if (phone.primary && this.phones.some((candidate) => candidate.contactId === phone.contactId && candidate.primary)) {
      throw new Error("contact_phones_one_primary_per_contact");
    }
    this.phones.push(phone);
    return { ...phone };
  }

  async updatePhone(id: string, input: Pick<ContactPhoneInput, "number" | "type" | "extension" | "label" | "primary"> & {
    normalizedNumber: string | null;
    updatedAt: Date;
  }) {
    const index = this.phones.findIndex((phone) => phone.id === id);
    if (index < 0) throw new Error("Contact phone is missing.");
    const next = { ...this.phones[index]!, ...input };
    if (next.primary && this.phones.some((candidate) => candidate.id !== id && candidate.contactId === next.contactId && candidate.primary)) {
      throw new Error("contact_phones_one_primary_per_contact");
    }
    this.phones[index] = next;
    return { ...next };
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

  it("mirrors the primary read from the transaction rather than the outer store", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);

    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
    ], now);

    expect(await store.loadLegacyContact(contactId)).toMatchObject({
      phone: "701-555-0199",
      normalizedPhone: "+17015550199",
    });
  });

  it("stages a primary swap without transiently violating the one-primary constraint", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);
    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0100", type: "office", extension: null, label: null, primary: true },
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: false },
    ], now);
    const [office, mobile] = await repository.listForContact(contactId);

    await repository.replaceForContact(contactId, [
      { id: mobile!.id, number: mobile!.number, type: "mobile", extension: null, label: null, primary: true },
      { id: office!.id, number: office!.number, type: "office", extension: null, label: null, primary: false },
    ], now);

    expect(await repository.listForContact(contactId)).toMatchObject([
      { id: mobile!.id, primary: true },
      { id: office!.id, primary: false },
    ]);
  });

  it("keeps generated phone IDs unique across inserting transactions", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);
    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0100", type: "office", extension: null, label: null, primary: true },
    ], now);
    const [office] = await repository.listForContact(contactId);

    await repository.replaceForContact(contactId, [
      { id: office!.id, number: office!.number, type: office!.type, extension: null, label: null, primary: true },
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: false },
    ], now);

    expect(new Set((await repository.listForContact(contactId)).map(({ id }) => id)).size).toBe(2);
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

  it("self-heals a legacy-only phone into an idempotent primary row", async () => {
    const store = new MemoryContactPhoneStore();
    Object.assign(store.contact, {
      phone: "701-555-0199",
      normalizedPhone: "+17015550199",
    });
    const repository = new ContactPhoneRepository(store);

    await expect(repository.listForContact(contactId)).resolves.toMatchObject([
      { number: "701-555-0199", normalizedNumber: "+17015550199", primary: true, source: "local" },
    ]);
    await expect(repository.listForContact(contactId)).resolves.toHaveLength(1);
  });

  it("rejects omission of a suppressed phone without deleting any rows", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);
    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
      { id: null, number: "701-555-0100", type: "office", extension: "12", label: null, primary: false },
    ], now);
    const [mobile, office] = await repository.listForContact(contactId);
    await repository.markDoNotCall(mobile!.id, "Requested", now);

    await expect(repository.replaceForContact(contactId, [{
      id: office!.id, number: office!.number, type: office!.type,
      extension: office!.extension, label: office!.label, primary: true,
    }], now)).rejects.toThrow("suppressed phone number cannot be removed");

    expect(await repository.listForContact(contactId)).toHaveLength(2);
  });

  it("rejects a new row whose canonical destination already belongs to the contact", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);
    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
    ], now);
    const [existing] = await repository.listForContact(contactId);

    await expect(repository.replaceForContact(contactId, [
      { id: existing!.id, number: existing!.number, type: existing!.type, extension: null, label: null, primary: true },
      { id: null, number: "701-555-0199", type: "alternate", extension: null, label: null, primary: false },
    ], now)).rejects.toThrow("normalized phone destination already exists");

    expect(await repository.listForContact(contactId)).toMatchObject([
      { id: existing!.id, number: "701-555-0199", primary: true },
    ]);
  });

  it("rejects formatting an edited row as another row's canonical destination", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);
    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
      { id: null, number: "701-555-0100", type: "office", extension: null, label: null, primary: false },
    ], now);
    const [mobile, office] = await repository.listForContact(contactId);

    await expect(repository.replaceForContact(contactId, [
      { id: mobile!.id, number: mobile!.number, type: mobile!.type, extension: null, label: null, primary: true },
      { id: office!.id, number: "(701) 555-0199", type: office!.type, extension: null, label: null, primary: false },
    ], now)).rejects.toThrow("normalized phone destination already exists");

    expect(await repository.listForContact(contactId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: mobile!.id, normalizedNumber: "+17015550199" }),
      expect.objectContaining({ id: office!.id, normalizedNumber: "+17015550100" }),
    ]));
  });

  it("cannot recreate a suppressed destination as a new unsuppressed row", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);
    await repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
    ], now);
    const [suppressed] = await repository.listForContact(contactId);
    await repository.markDoNotCall(suppressed!.id, "Requested", now);

    await expect(repository.replaceForContact(contactId, [
      { id: suppressed!.id, number: suppressed!.number, type: suppressed!.type, extension: null, label: null, primary: false },
      { id: null, number: "+1 701 555 0199", type: "alternate", extension: null, label: null, primary: true },
    ], now)).rejects.toThrow("normalized phone destination already exists");

    expect(await repository.listForContact(contactId)).toMatchObject([
      { id: suppressed!.id, normalizedNumber: "+17015550199", doNotCallAt: now, doNotCallReason: "Requested" },
    ]);
  });

  it("continues to accept distinct canonical destinations", async () => {
    const store = new MemoryContactPhoneStore();
    const repository = new ContactPhoneRepository(store);

    await expect(repository.replaceForContact(contactId, [
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
      { id: null, number: "+1 (701) 555-0100", type: "office", extension: null, label: null, primary: false },
    ], now)).resolves.toMatchObject([
      { normalizedNumber: "+17015550199", primary: true },
      { normalizedNumber: "+17015550100", primary: false },
    ]);
  });
});
