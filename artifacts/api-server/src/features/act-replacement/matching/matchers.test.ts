import { describe, expect, it } from "vitest";
import { matchContact, type ContactMatchSource, type LocalContactCandidate } from "./contact-matcher";
import { matchOrganization, type LocalOrganizationCandidate } from "./organization-matcher";
import { matchBooking, type LocalBookingCandidate } from "./booking-matcher";

const contact = (overrides: Partial<ContactMatchSource> = {}): ContactMatchSource => ({
  sourceRecordId: "source-contact",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  emailIdentityMatchSafe: true,
  phone: "555-123-4567",
  jobTitle: null,
  address1: null,
  address2: null,
  city: null,
  region: null,
  postalCode: null,
  ...overrides,
});

const localContact = (overrides: Partial<LocalContactCandidate> = {}): LocalContactCandidate => ({
  id: "contact-1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  phone: "5551234567",
  ...overrides,
});

const organization = (overrides: Partial<Parameters<typeof matchOrganization>[0]> = {}) => ({
  sourceRecordId: "source-company",
  name: "Acme Adventures",
  phone: "555-111-2222",
  website: "https://www.acme.example.com/",
  industry: null,
  address1: "1 Main St",
  address2: null,
  city: "Denver",
  region: "CO",
  postalCode: "80202",
  ...overrides,
});

const localOrganization = (overrides: Partial<LocalOrganizationCandidate> = {}): LocalOrganizationCandidate => ({
  id: "org-1",
  name: "Acme Adventures",
  phone: "5551112222",
  website: "acme.example.com",
  address1: "1 Main St",
  city: "Denver",
  region: "CO",
  postalCode: "80202",
  ...overrides,
});

describe("conservative Act replacement matchers", () => {
  it("prefers one exact external link and sorts ambiguous link candidates", () => {
    const source = contact({ externalLinks: [{ localId: "contact-9", sourceRecordId: "source-contact", sourceDatabaseKey: "db-1" }] });
    expect(matchContact(source, [localContact()], { sourceDatabaseKey: "db-1" })).toEqual({
      kind: "exact", localId: "contact-9", reason: "exact_external_link",
    });
    const ambiguous = contact({ externalLinks: [
      { localId: "contact-z", sourceRecordId: "source-contact", sourceDatabaseKey: "db-1" },
      { localId: "contact-a", sourceRecordId: "source-contact", sourceDatabaseKey: "db-1" },
    ] });
    expect(matchContact(ambiguous, [], { sourceDatabaseKey: "db-1" })).toEqual({
      kind: "ambiguous", candidateIds: ["contact-a", "contact-z"], reason: "multiple_exact_external_links",
    });
    expect(matchContact(contact({ externalLinks: [{ localId: "contact-9", sourceDatabaseKey: "db-1" }] }), [], { sourceDatabaseKey: "db-1" })).toEqual({ kind: "ambiguous", candidateIds: ["contact-9"], reason: "external_link_requires_review" });
  });

  it("matches contacts by unique non-shared email, then unique phone", () => {
    expect(matchContact(contact(), [localContact({ id: "contact-2", email: "other@example.com", phone: null }), localContact()])).toEqual({
      kind: "exact", localId: "contact-1", reason: "unique_normalized_email",
    });
    expect(matchContact(contact({ email: null, emailIdentityMatchSafe: false }), [localContact({ email: null, phone: "(555) 123-4567" })])).toEqual({
      kind: "exact", localId: "contact-1", reason: "unique_normalized_phone",
    });
  });

  it("blocks shared mailboxes, duplicate identifiers, and conflicting identifiers", () => {
    expect(matchContact(contact({ email: "info@example.com", emailIdentityMatchSafe: false, phone: null }), [localContact({ id: "a", email: "info@example.com", phone: null })])).toEqual({
      kind: "ambiguous", candidateIds: ["a"], reason: "name_only_match_requires_review",
    });
    expect(matchContact(contact(), [localContact({ id: "z" }), localContact({ id: "a" })])).toEqual({
      kind: "ambiguous", candidateIds: ["a", "z"], reason: "multiple_normalized_email_candidates",
    });
    expect(matchContact(contact(), [localContact({ id: "email", phone: "9999999999" }), localContact({ id: "phone", email: "other@example.com" , phone: "5551234567" })])).toEqual({
      kind: "ambiguous", candidateIds: ["email", "phone"], reason: "conflicting_contact_identity",
    });
  });

  it("allows manual assignment to override source conflict", () => {
    expect(matchContact(contact({ manualAssignment: { localId: "manual-contact" } }), [localContact()], { sourceDatabaseKey: "db" })).toEqual({
      kind: "exact", localId: "manual-contact", reason: "manual_assignment",
    });
  });

  it("requires two agreeing strong organization fields and rejects conflicting candidates", () => {
    expect(matchOrganization(organization(), [localOrganization()])).toEqual({
      kind: "exact", localId: "org-1", reason: "two_strong_organization_fields",
    });
    expect(matchOrganization(organization({ name: "Acme Adventures", phone: null, website: null, address1: null, postalCode: null, city: null, region: null }), [localOrganization({ id: "z", city: "Boulder", region: null, phone: null, website: null, address1: null, postalCode: null }), localOrganization({ id: "a", city: "Denver", region: null, phone: null, website: null, address1: null, postalCode: null })])).toEqual({
      kind: "ambiguous", candidateIds: ["a", "z"], reason: "insufficient_agreeing_organization_fields",
    });
    expect(matchOrganization(organization(), [localOrganization({ phone: "9999999999", address1: "99 Other St", postalCode: "99999" })])).toEqual({
      kind: "none", reason: "conflicting_organization_fields",
    });
    expect(matchOrganization(organization({ region: null, phone: null, website: null, address1: null, postalCode: null }), [localOrganization({ region: null, phone: null, website: null, address1: null, postalCode: null })])).toEqual({ kind: "ambiguous", candidateIds: ["org-1"], reason: "insufficient_agreeing_organization_fields" });
  });

  it("requires an exact organization, exact name, and compatible date for bookings", () => {
    const source: import("./booking-matcher").BookingMatchSource = {
      kind: "booking", sourceRecordId: "opp-1", name: "Summer Trip", organizationSourceId: "company-1", startsAt: "2026-08-12", endsAt: null,
      venueName: null, address1: null, address2: null, city: "Denver", region: "CO", postalCode: "80202", actStatus: null, localStatus: null, probabilityPercent: null, localProbability: null, amount: null, notes: null,
    };
    const candidates: LocalBookingCandidate[] = [
      { id: "booking-1", name: "Summer Trip", organizationId: "org-1", startsAt: "2026-08-12" },
    ];
    expect(matchBooking(source, candidates, { kind: "exact", localId: "org-1", reason: "manual_assignment" })).toEqual({ kind: "exact", localId: "booking-1", reason: "exact_organization_name_date" });
    expect(matchBooking(source, candidates, { kind: "ambiguous", candidateIds: ["org-1", "org-2"], reason: "multiple" })).toEqual({ kind: "none", reason: "organization_match_not_exact" });
    expect(matchBooking(source, [{ ...candidates[0], startsAt: "2026-08-13" }], { kind: "exact", localId: "org-1", reason: "x" })).toEqual({ kind: "none", reason: "no_compatible_booking_date" });
  });

  it("is deterministic regardless of candidate order and never uses text", () => {
    const source = contact({ email: null, emailIdentityMatchSafe: false, phone: null });
    const candidates = [localContact({ id: "z", email: null, phone: null }), localContact({ id: "a", email: null, phone: null })];
    expect(matchContact(source, candidates)).toEqual(matchContact(source, [...candidates].reverse()));
    expect(matchContact(source, candidates)).toEqual({ kind: "ambiguous", candidateIds: ["a", "z"], reason: "name_only_match_requires_review" });
  });
});
