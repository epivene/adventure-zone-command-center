import { buildProfileSearchTerms, profileSearchScore } from "@/features/organizations/profile-search";
import type { ContactListPage, ContactListQuery, ContactListRecord } from "./contact-types";

type ContactListRepository = {
  listContacts(query: ContactListQuery): Promise<ContactListPage>;
};

const MAX_CONTACT_CANDIDATES = 5_000;

function searchableValues(contact: ContactListRecord): string[] {
  return [
    contact.firstName,
    contact.lastName,
    [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    contact.organizationName,
    contact.jobTitle,
    contact.email,
    contact.phone,
    contact.address1,
    contact.address2,
    contact.city,
    contact.region,
    contact.postalCode,
  ].filter((value): value is string => Boolean(value));
}

export class ForgivingContactSearchService {
  constructor(private readonly repository: ContactListRepository) {}

  async listContacts(query: ContactListQuery): Promise<ContactListPage> {
    const exact = await this.repository.listContacts(query);
    if (!query.search || exact.total > 0) return exact;

    const terms = buildProfileSearchTerms(query.search);
    if (!terms.length) return exact;
    const candidates = await this.repository.listContacts({
      ...query,
      search: "",
      page: 1,
      pageSize: MAX_CONTACT_CANDIDATES,
    });
    const ranked = candidates.records
      .map((contact, index) => ({ contact, index, score: profileSearchScore(terms, searchableValues(contact)) }))
      .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
      .sort((left, right) => left.score - right.score || left.index - right.index);
    const offset = (query.page - 1) * query.pageSize;
    const total = ranked.length;

    return {
      records: ranked.slice(offset, offset + query.pageSize).map((entry) => entry.contact),
      total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
}
