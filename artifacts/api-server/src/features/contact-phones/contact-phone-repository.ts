import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { contactPhones, contacts } from "@/db/schema";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";

import type { ContactPhoneInput, ContactPhoneRecord, ContactPhoneType } from "./contact-phone-types";

export type { ContactPhoneInput, ContactPhoneRecord, ContactPhoneType } from "./contact-phone-types";

export type LegacyContactPhoneFields = {
  id: string;
  organizationId: string | null;
  phone: string | null;
  normalizedPhone: string | null;
};

type NewPhone = Omit<ContactPhoneRecord, "id" | "source" | "doNotCallAt" | "doNotCallReason">;
type PhoneUpdate = Pick<ContactPhoneInput, "number" | "type" | "extension" | "label" | "primary"> & {
  normalizedNumber: string | null;
  updatedAt: Date;
};

export interface ContactPhoneStore {
  transaction<T>(callback: (store: ContactPhoneStore) => Promise<T>): Promise<T>;
  lockContact(id: string): Promise<LegacyContactPhoneFields | null>;
  listForContact(contactId: string): Promise<ContactPhoneRecord[]>;
  insertPhone(input: NewPhone): Promise<ContactPhoneRecord>;
  updatePhone(id: string, input: PhoneUpdate): Promise<ContactPhoneRecord>;
  deletePhones(ids: string[]): Promise<void>;
  updateLegacyContact(id: string, phone: string | null, normalizedPhone: string | null): Promise<void>;
  markPhoneDoNotCall(id: string, reason: string, at: Date): Promise<ContactPhoneRecord>;
}

export class ContactPhoneRepository {
  constructor(private readonly store: ContactPhoneStore) {}

  async listForContact(contactId: string): Promise<ContactPhoneRecord[]> {
    return (await this.store.listForContact(contactId))
      .toSorted((left, right) => Number(right.primary) - Number(left.primary) || left.id.localeCompare(right.id));
  }

  async replaceForContact(contactId: string, inputs: ContactPhoneInput[], now: Date): Promise<ContactPhoneRecord[]> {
    return this.store.transaction(async (store) => {
      const contact = await store.lockContact(contactId);
      if (!contact) throw new Error("Contact is missing.");
      if (inputs.some((input) => !input.number.trim())) throw new Error("Contact phone numbers cannot be blank.");
      if (new Set(inputs.filter((input) => input.id !== null).map((input) => input.id)).size !== inputs.filter((input) => input.id !== null).length) {
        throw new Error("Contact phone IDs must be unique.");
      }
      if (inputs.length && inputs.filter((input) => input.primary).length !== 1) {
        throw new Error("Exactly one contact phone must be primary.");
      }

      const existing = await store.listForContact(contactId);
      const existingById = new Map(existing.map((phone) => [phone.id, phone]));
      const retained = new Set<string>();
      for (const input of inputs) {
        const normalizedNumber = normalizeNorthAmericanPhone(input.number);
        if (input.id === null) {
          await store.insertPhone({ ...input, contactId, normalizedNumber, createdAt: now, updatedAt: now });
          continue;
        }
        const prior = existingById.get(input.id);
        if (!prior) throw new Error("Contact phone does not belong to this contact.");
        if (prior.doNotCallAt && prior.normalizedNumber !== normalizedNumber) {
          throw new Error("A suppressed phone number cannot be changed; add a new number to preserve suppression history.");
        }
        retained.add(input.id);
        await store.updatePhone(input.id, { ...input, normalizedNumber, updatedAt: now });
      }
      const deleted = existing.filter((phone) => !retained.has(phone.id) && !inputs.some((input) => input.id === null && false)).map((phone) => phone.id);
      if (deleted.length) await store.deletePhones(deleted);

      const phones = await this.listForContact(contactId);
      const primary = phones.find((phone) => phone.primary) ?? null;
      await store.updateLegacyContact(contactId, primary?.number ?? null, primary?.normalizedNumber ?? null);
      return phones;
    });
  }

  async markDoNotCall(phoneId: string, reason: string, now: Date): Promise<ContactPhoneRecord> {
    if (!reason.trim()) throw new Error("A Do Not Call reason is required.");
    return this.store.transaction((store) => store.markPhoneDoNotCall(phoneId, reason.trim(), now));
  }
}

type DrizzleDatabase = typeof database;

export class DrizzleContactPhoneStore implements ContactPhoneStore {
  constructor(private readonly database: DrizzleDatabase) {}

  transaction<T>(callback: (store: ContactPhoneStore) => Promise<T>) {
    return this.database.transaction((transaction) => callback(new DrizzleContactPhoneStore(transaction as DrizzleDatabase)));
  }

  async lockContact(id: string) {
    const [contact] = await this.database.select({
      id: contacts.id, organizationId: contacts.organizationId, phone: contacts.phone, normalizedPhone: contacts.normalizedPhone,
    }).from(contacts).where(eq(contacts.id, id)).limit(1).for("update");
    return contact ?? null;
  }

  listForContact(contactId: string) {
    return this.database.select().from(contactPhones).where(eq(contactPhones.contactId, contactId)).orderBy(desc(contactPhones.primary), asc(contactPhones.id));
  }

  async insertPhone(input: NewPhone) {
    const [phone] = await this.database.insert(contactPhones).values({ ...input, source: "local", doNotCallAt: null, doNotCallReason: null }).returning();
    if (!phone) throw new Error("Contact phone could not be created.");
    return phone;
  }

  async updatePhone(id: string, input: PhoneUpdate) {
    const [phone] = await this.database.update(contactPhones).set(input).where(eq(contactPhones.id, id)).returning();
    if (!phone) throw new Error("Contact phone is missing.");
    return phone;
  }

  async deletePhones(ids: string[]) {
    if (ids.length) await this.database.delete(contactPhones).where(inArray(contactPhones.id, ids));
  }

  async updateLegacyContact(id: string, phone: string | null, normalizedPhone: string | null) {
    await this.database.update(contacts).set({ phone, normalizedPhone, updatedAt: new Date() }).where(eq(contacts.id, id));
  }

  async markPhoneDoNotCall(id: string, reason: string, at: Date) {
    const [phone] = await this.database.update(contactPhones)
      .set({ doNotCallAt: at, doNotCallReason: reason, updatedAt: at })
      .where(eq(contactPhones.id, id)).returning();
    if (!phone) throw new Error("Contact phone is missing.");
    return phone;
  }
}

export const createContactPhoneRepository = (database: DrizzleDatabase) =>
  new ContactPhoneRepository(new DrizzleContactPhoneStore(database));
