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

type NewPhone = Omit<ContactPhoneRecord, "id" | "source" | "doNotCallAt" | "doNotCallReason"> & { createdAt: Date; updatedAt: Date };
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
    return this.store.transaction(async (store) => {
      let phones = await store.listForContact(contactId);
      if (!phones.length) {
        const contact = await store.lockContact(contactId);
        phones = await store.listForContact(contactId);
        if (!phones.length && contact?.phone?.trim()) {
          const now = new Date();
          await store.insertPhone({
            contactId,
            number: contact.phone,
            normalizedNumber: contact.normalizedPhone,
            type: "unknown",
            extension: null,
            label: null,
            primary: true,
            createdAt: now,
            updatedAt: now,
          });
          phones = await store.listForContact(contactId);
        }
      }
      return phones.toSorted((left, right) => Number(right.primary) - Number(left.primary) || left.id.localeCompare(right.id));
    });
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
      const normalizedInputs = inputs.map((input) => ({
        input,
        normalizedNumber: normalizeNorthAmericanPhone(input.number),
      }));
      const requestedNormalizedNumbers = normalizedInputs
        .map(({ normalizedNumber }) => normalizedNumber)
        .filter((value): value is string => value !== null);
      const duplicatesAnotherRequestedRow = new Set(requestedNormalizedNumbers).size !== requestedNormalizedNumbers.length;
      const duplicatesExistingRow = normalizedInputs.some(({ input, normalizedNumber }) =>
        normalizedNumber !== null && existing.some((phone) =>
          phone.id !== input.id && phone.normalizedNumber === normalizedNumber,
        ));
      if (duplicatesAnotherRequestedRow || duplicatesExistingRow) {
        throw new Error("That normalized phone destination already exists for this contact; edit the existing phone instead.");
      }
      const requestedIds = new Set(inputs.flatMap((input) => input.id ? [input.id] : []));
      if (existing.some((phone) => phone.doNotCallAt && !requestedIds.has(phone.id))) {
        throw new Error("A suppressed phone number cannot be removed; keep it to preserve suppression history.");
      }
      const existingById = new Map(existing.map((phone) => [phone.id, phone]));
      const retained = new Set<string>();
      // The partial unique index is immediate, so remove every current primary
      // before promoting either an existing or newly inserted replacement.
      for (const phone of existing.filter((phone) => phone.primary)) {
        await store.updatePhone(phone.id, {
          number: phone.number, type: phone.type, extension: phone.extension,
          label: phone.label, primary: false,
          normalizedNumber: phone.normalizedNumber, updatedAt: now,
        });
      }
      for (const { input, normalizedNumber } of normalizedInputs) {
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
      const deleted = existing.filter((phone) => !retained.has(phone.id)).map((phone) => phone.id);
      if (deleted.length) await store.deletePhones(deleted);

      const phones = (await store.listForContact(contactId))
        .toSorted((left, right) => Number(right.primary) - Number(left.primary) || left.id.localeCompare(right.id));
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

  transaction<T>(callback: (store: ContactPhoneStore) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) => callback(new DrizzleContactPhoneStore(transaction as unknown as DrizzleDatabase)));
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
