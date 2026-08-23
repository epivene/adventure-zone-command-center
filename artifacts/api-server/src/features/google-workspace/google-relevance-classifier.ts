import type { GoogleMessageMetadata } from "./google-api-types";

export type GoogleRelevanceCandidate = {
  id: string;
  name: string;
  kind: "contact" | "organization" | "profile" | "booking";
};

export type GoogleRelevanceResult = {
  status: "matched" | "review" | "ignored";
  evidenceCodes: string[];
  candidates: GoogleRelevanceCandidate[];
};

type Evidence = {
  approvedLabelIds: Set<string>;
  contacts: Array<{ id: string; name: string; emails: string[] }>;
  organizations: Array<{ id: string; name: string; domains: string[] }>;
  profiles: Array<{ id: string; name: string }>;
  existingThreadTarget: null | {
    id: string;
    name: string;
    kind: "profile" | "organization" | "booking";
  };
};

const publicMailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function extractEmails(value: string): string[] {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map(normalize))];
}

function participantEmails(message: GoogleMessageMetadata): string[] {
  return [message.headers.from, message.headers.to, message.headers.cc]
    .flatMap(extractEmails)
    .filter(Boolean);
}

function domainOf(email: string): string | null {
  const index = email.lastIndexOf("@");
  if (index < 0 || index === email.length - 1) return null;
  return normalize(email.slice(index + 1));
}

function exactTextContains(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalize(needle);
  if (normalizedNeedle.length < 4) return false;
  return normalize(haystack).includes(normalizedNeedle);
}

export function classifyGoogleMessageRelevance(input: {
  message: GoogleMessageMetadata;
  evidence: Evidence;
}): GoogleRelevanceResult {
  const { message, evidence } = input;
  const evidenceCodes: string[] = [];
  const candidates: GoogleRelevanceCandidate[] = [];
  const candidateKeys = new Set<string>();

  const addCandidate = (candidate: GoogleRelevanceCandidate) => {
    const key = `${candidate.kind}:${candidate.id}`;
    if (candidateKeys.has(key)) return;
    candidateKeys.add(key);
    candidates.push(candidate);
  };

  if (evidence.existingThreadTarget) {
    evidenceCodes.push("existing_thread_association");
    addCandidate(evidence.existingThreadTarget);
    return { status: "matched", evidenceCodes, candidates };
  }

  const emails = participantEmails(message);
  const emailSet = new Set(emails);

  for (const contact of evidence.contacts) {
    if (contact.emails.some((email) => emailSet.has(normalize(email)))) {
      evidenceCodes.push("exact_contact_email");
      addCandidate({ id: contact.id, name: contact.name, kind: "contact" });
    }
  }
  if (evidenceCodes.includes("exact_contact_email")) {
    return { status: "matched", evidenceCodes, candidates };
  }

  const participantDomains = new Set(
    emails.map(domainOf).filter((value): value is string => Boolean(value)),
  );
  const organizationMatches = evidence.organizations.filter((organization) =>
    organization.domains.some((domain) => {
      const normalizedDomain = normalize(domain);
      return (
        normalizedDomain.length > 0 &&
        !publicMailDomains.has(normalizedDomain) &&
        participantDomains.has(normalizedDomain)
      );
    }),
  );
  if (organizationMatches.length === 1) {
    const organization = organizationMatches[0];
    evidenceCodes.push("exact_organization_domain");
    addCandidate({
      id: organization.id,
      name: organization.name,
      kind: "organization",
    });
    return { status: "matched", evidenceCodes, candidates };
  }

  const hasApprovedBusinessLabel = message.labelIds.some((id) =>
    evidence.approvedLabelIds.has(id),
  );
  if (hasApprovedBusinessLabel) {
    evidenceCodes.push("approved_business_label");
  }

  const boundedText = `${message.headers.subject}\n${message.snippet}`;
  for (const profile of evidence.profiles) {
    if (exactTextContains(boundedText, profile.name)) {
      evidenceCodes.push("exact_profile_name_text");
      addCandidate({ id: profile.id, name: profile.name, kind: "profile" });
    }
  }

  if (
    evidenceCodes.includes("approved_business_label") ||
    evidenceCodes.includes("exact_profile_name_text") ||
    organizationMatches.length > 1
  ) {
    if (organizationMatches.length > 1) {
      evidenceCodes.push("ambiguous_organization_domain");
      for (const organization of organizationMatches) {
        addCandidate({
          id: organization.id,
          name: organization.name,
          kind: "organization",
        });
      }
    }
    return { status: "review", evidenceCodes, candidates };
  }

  return { status: "ignored", evidenceCodes, candidates };
}
