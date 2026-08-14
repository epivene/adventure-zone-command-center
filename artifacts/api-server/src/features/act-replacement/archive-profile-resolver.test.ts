import { describe, expect, it } from "vitest";
import {
  resolveArchiveProfile,
  sourceWins,
} from "./archive-profile-resolver";
import type {
  ArchiveProfileSource,
  ProfileCandidate,
} from "./archive-profile-import-types";

const companySource = (rawSnapshot: Record<string, unknown>): ArchiveProfileSource => ({
  sourceRecordId: "company-source-1",
  sourceVersionId: "company-version-1",
  streamType: "company",
  actRecordId: "act-company-1",
  rawSnapshot,
  relationshipEvidence: {},
});

const contactSource = (rawSnapshot: Record<string, unknown>): ArchiveProfileSource => ({
  sourceRecordId: "contact-source-1",
  sourceVersionId: "contact-version-1",
  streamType: "contact",
  actRecordId: "act-contact-1",
  rawSnapshot,
  relationshipEvidence: {},
});

const contactCandidate = (
  id: string,
  exactSignals: ProfileCandidate["exactSignals"],
  values: Record<string, string | null>,
): ProfileCandidate => ({ id, entityType: "contact", exactSignals, values });

const organizationCandidate = (
  id: string,
  exactSignals: ProfileCandidate["exactSignals"],
  values: Record<string, string | null>,
): ProfileCandidate => ({ id, entityType: "organization", exactSignals, values });

describe("resolveArchiveProfile", () => {
  it("preserves a usable profile whose archived ACT identity is absent", () => {
    const resolution = resolveArchiveProfile({
      source: {
        ...companySource({ Name: "Fallback Identity Company" }),
        actRecordId: null,
      },
      candidates: [],
      linkedTarget: null,
    });

    expect(resolution).toEqual({
      action: "preserve",
      reasonCode: "missing_act_record_id",
      evidenceLabels: ["missing_act_record_id"],
    });
  });

  it("links one exact email match and applies non-null ACT values", () => {
    const resolution = resolveArchiveProfile({
      source: contactSource({
        FirstName: "Ada",
        LastName: "Lovelace",
        EmailAddress: "ada@example.com",
        BusinessPhone: "(512) 555-0101",
        JobTitle: "ACT Analyst",
        BusinessAddress: { Line1: "12 ACT Way", City: "Austin", State: "TX" },
      }),
      candidates: [
        contactCandidate("contact-local-1", ["email"], {
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          phone: "(206) 555-0188",
          jobTitle: "Local title",
          address1: "99 Local Road",
          address2: "Suite 3",
          city: "Seattle",
          region: "WA",
          postalCode: "98101",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "update_existing",
      targetEntityType: "contact",
      targetEntityId: "contact-local-1",
      evidenceLabels: ["email"],
      values: {
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "(512) 555-0101",
        jobTitle: "ACT Analyst",
        address1: "12 ACT Way",
        address2: "Suite 3",
        city: "Austin",
        region: "TX",
        postalCode: "98101",
      },
    });
  });

  it("creates a separate contact when two exact candidates remain", () => {
    const resolution = resolveArchiveProfile({
      source: contactSource({
        FirstName: "Ada",
        LastName: "Lovelace",
        EmailAddress: "ada@example.com",
        BusinessPhone: "(512) 555-0101",
      }),
      candidates: [
        contactCandidate("contact-local-1", ["email"], { email: "ada@example.com" }),
        contactCandidate("contact-local-2", ["phone_and_name"], {
          firstName: "Ada",
          lastName: "Lovelace",
          phone: "512-555-0101",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "create_profile",
      targetEntityType: "contact",
      evidenceLabels: ["ambiguous_exact_match"],
      values: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });
  });

  it("requests AI instead of creating an identity-incomplete contact with two exact matches", () => {
    const resolution = resolveArchiveProfile({
      source: contactSource({ FirstName: "Casey", EmailAddress: "casey@example.com" }),
      candidates: [
        contactCandidate("contact-local-1", ["email"], {
          firstName: "Casey",
          lastName: "Jones",
          email: "casey@example.com",
        }),
        contactCandidate("contact-local-2", ["email"], {
          firstName: "Casey",
          lastName: "Smith",
          email: "casey@example.com",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "needs_ai",
      evidenceLabels: ["ambiguous_exact_match", "missing_required_identity"],
      projection: {
        sourceRecordId: "contact-source-1",
        streamType: "contact",
        contextLabels: [],
        supportedFields: {
          firstName: "Casey",
          lastName: "",
          email: "casey@example.com",
        },
      },
    });
    if (resolution.action !== "needs_ai") throw new Error("expected AI review");
    expect(resolution.projection).not.toHaveProperty("candidates");
  });

  it("requests AI with bounded ambiguity evidence for an identity-incomplete company candidate set", () => {
    const resolution = resolveArchiveProfile({
      source: companySource({ Phone: "(512) 555-0100" }),
      candidates: [
        organizationCandidate("organization-local-1", ["company_name_and_location"], {
          name: "Orbit Music",
          phone: "(512) 555-0100",
        }),
        organizationCandidate("organization-local-2", ["company_name_and_location"], {
          name: "Orbit Events",
          phone: "(512) 555-0100",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "needs_ai",
      evidenceLabels: ["ambiguous_exact_match", "missing_required_identity"],
      projection: {
        sourceRecordId: "company-source-1",
        streamType: "company",
        contextLabels: [],
        supportedFields: { name: "", phone: "(512) 555-0100" },
      },
    });
    if (resolution.action !== "needs_ai") throw new Error("expected AI review");
    expect(resolution.projection).not.toHaveProperty("candidates");
  });

  it("creates a company when no candidate matches", () => {
    const resolution = resolveArchiveProfile({
      source: companySource({ Name: "Orbit Music", Phone: "(512) 555-0100" }),
      candidates: [],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "create_profile",
      targetEntityType: "organization",
      evidenceLabels: ["no_exact_match"],
      values: { name: "Orbit Music", phone: "(512) 555-0100" },
    });
  });

  it("classifies an existing active source link as already imported", () => {
    const linkedTarget = contactCandidate("contact-local-9", ["source_link"], {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "old@example.com",
    });
    const resolution = resolveArchiveProfile({
      source: contactSource({ FirstName: "Ada", LastName: "Lovelace", EmailAddress: "ada@example.com" }),
      candidates: [],
      linkedTarget,
    });

    expect(resolution).toMatchObject({
      action: "already_imported",
      targetEntityType: "contact",
      targetEntityId: "contact-local-9",
      evidenceLabels: ["source_link"],
      values: { email: "old@example.com" },
    });
  });

  it("classifies an invalid linked snapshot as already imported before normalization", () => {
    const linkedTarget = contactCandidate("contact-local-9", ["source_link"], {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const resolution = resolveArchiveProfile({
      source: { ...contactSource({}), rawSnapshot: null as unknown as Record<string, unknown> },
      candidates: [],
      linkedTarget,
    });

    expect(resolution).toMatchObject({
      action: "already_imported",
      targetEntityId: "contact-local-9",
      evidenceLabels: ["source_link"],
    });
  });

  it("does not trust a safely labeled email candidate when its normalized email differs", () => {
    const resolution = resolveArchiveProfile({
      source: contactSource({ FirstName: "Ada", LastName: "Lovelace", EmailAddress: "ada@example.com" }),
      candidates: [
        contactCandidate("contact-local-1", ["email"], {
          firstName: "Ada",
          lastName: "Lovelace",
          email: "other@example.com",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({ action: "create_profile", evidenceLabels: ["no_exact_match"] });
  });

  it("does not trust a phone-and-name label without normalized phone and name agreement", () => {
    const resolution = resolveArchiveProfile({
      source: contactSource({
        FirstName: "Ada",
        LastName: "Lovelace",
        BusinessPhone: "(512) 555-0101",
      }),
      candidates: [
        contactCandidate("contact-local-1", ["phone_and_name"], {
          firstName: "Ada",
          lastName: "Lovelace",
          phone: "(206) 555-0188",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({ action: "create_profile", evidenceLabels: ["no_exact_match"] });
  });

  it("links a phone-and-name match only after normalized phone and names agree", () => {
    const resolution = resolveArchiveProfile({
      source: contactSource({
        FirstName: "Ada",
        LastName: "Lovelace",
        BusinessPhone: "(512) 555-0101",
      }),
      candidates: [
        contactCandidate("contact-local-1", ["phone_and_name"], {
          firstName: " ada ",
          lastName: "LOVELACE",
          phone: "512.555.0101",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "update_existing",
      targetEntityId: "contact-local-1",
      evidenceLabels: ["phone_and_name"],
    });
  });

  it("does not trust a company name-and-location label when the location differs", () => {
    const resolution = resolveArchiveProfile({
      source: companySource({ Name: "Orbit Music", Address: { City: "Austin", State: "TX" } }),
      candidates: [
        organizationCandidate("organization-local-1", ["company_name_and_location"], {
          name: "Orbit Music",
          city: "Dallas",
          region: "TX",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({ action: "create_profile", evidenceLabels: ["no_exact_match"] });
  });

  it("links a company only when its normalized name and location agree", () => {
    const resolution = resolveArchiveProfile({
      source: companySource({ Name: "Orbit Music", Address: { City: "Austin", State: "TX" } }),
      candidates: [
        organizationCandidate("organization-local-1", ["company_name_and_location"], {
          name: " orbit  music ",
          city: " AUSTIN ",
          region: "tx",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "update_existing",
      targetEntityId: "organization-local-1",
      evidenceLabels: ["company_name_and_location"],
    });
  });

  it("links a unique normalized company name when no source location exists", () => {
    const resolution = resolveArchiveProfile({
      source: companySource({ Name: "Orbit Music" }),
      candidates: [
        organizationCandidate("organization-local-1", ["company_name_and_location"], { name: "orbit music" }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "update_existing",
      targetEntityId: "organization-local-1",
      evidenceLabels: ["company_name_and_location"],
    });
  });

  it("creates a separate company when an unlocated normalized name is not unique", () => {
    const resolution = resolveArchiveProfile({
      source: companySource({ Name: "Orbit Music" }),
      candidates: [
        organizationCandidate("organization-local-1", ["company_name_and_location"], { name: "orbit music" }),
        organizationCandidate("organization-local-2", ["company_name_and_location"], { name: " Orbit  Music " }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({ action: "create_profile", evidenceLabels: ["no_exact_match"] });
  });

  it("does not use a shared mailbox email as an exact contact identity", () => {
    const resolution = resolveArchiveProfile({
      source: contactSource({ FirstName: "Info", LastName: "Desk", EmailAddress: "info@example.com" }),
      candidates: [
        contactCandidate("contact-local-1", ["email"], {
          firstName: "Info",
          lastName: "Desk",
          email: "info@example.com",
        }),
      ],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "create_profile",
      evidenceLabels: expect.arrayContaining(["no_exact_match", "shared_mailbox_email_identity_unsafe"]),
    });
  });

  it("does not erase a local field when the ACT value is null or blank", () => {
    expect(
      sourceWins(
        { phone: "(206) 555-0188", jobTitle: "Local title", address1: "99 Local Road", kind: "contact" } as Record<string, string | null>,
        { phone: null, jobTitle: "   ", address1: "12 ACT Way", emailIdentityMatchSafe: "true" },
      ),
    ).toEqual({
      phone: "(206) 555-0188",
      jobTitle: "Local title",
      address1: "12 ACT Way",
    });
  });

  it("requests AI only when required profile identity is missing", () => {
    const resolution = resolveArchiveProfile({
      source: contactSource({ EmailAddress: "unknown@example.com", BusinessPhone: "(512) 555-0100" }),
      candidates: [],
      linkedTarget: null,
    });

    expect(resolution).toEqual({
      action: "needs_ai",
      projection: {
        sourceRecordId: "contact-source-1",
        streamType: "contact",
        supportedFields: {
          firstName: "",
          lastName: "",
          email: "unknown@example.com",
          phone: "(512) 555-0100",
          jobTitle: null,
          address1: null,
          address2: null,
          city: null,
          region: null,
          postalCode: null,
        },
        contextLabels: [],
      },
      evidenceLabels: ["missing_required_identity"],
    });
  });

  it("preserves unsupported fields outside the writable value projection", () => {
    const resolution = resolveArchiveProfile({
      source: companySource({
        Name: "Orbit Music",
        Industry: "Entertainment",
        PrivateNote: "do not write this",
        CustomFields: { "Secret Segment": "internal" },
      }),
      candidates: [],
      linkedTarget: null,
    });

    expect(resolution).toMatchObject({
      action: "create_profile",
      targetEntityType: "organization",
      values: { name: "Orbit Music", industry: "Entertainment" },
      evidenceLabels: ["no_exact_match", "unsupported_source_fields"],
    });
    if (resolution.action !== "create_profile") throw new Error("expected a created company profile");
    expect(resolution.values).not.toHaveProperty("PrivateNote");
    expect(resolution.values).not.toHaveProperty("CustomFields");
    expect(resolution.values).not.toHaveProperty("kind");
  });
});
