import { db as defaultDb } from "@/db/client";
import { contacts, organizations } from "@/db/schema";

import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import type { GoogleMessageMetadata, GoogleWorkspaceReadClient } from "./google-api-types";
import { GoogleScopeService, type GoogleSavedScope } from "./google-scope-service";
import {
  classifyGoogleMessageRelevance,
  type GoogleRelevanceCandidate,
} from "./google-relevance-classifier";

export type GoogleValidationEvidenceSnapshot = {
  contacts: Array<{ id: string; name: string; emails: string[] }>;
  organizations: Array<{ id: string; name: string; domains: string[] }>;
  profiles: Array<{ id: string; name: string }>;
};

export type GoogleValidationRow = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  internalDateMs: number | null;
  labelIds: string[];
  hasAttachments: boolean;
  evidenceCodes: string[];
  candidates: GoogleRelevanceCandidate[];
};

export type GoogleRecentValidationResult = {
  checkedLimit: number;
  aiEnabled: false;
  historicalImportStarted: false;
  counts: {
    discovered: number;
    matched: number;
    needsReview: number;
    ignored: number;
  };
  matched: GoogleValidationRow[];
  needsReview: GoogleValidationRow[];
  ignored: GoogleValidationRow[];
};

type ConnectionAccess = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

type ScopeAccess = {
  getSaved(): Promise<GoogleSavedScope>;
};

type EvidenceAccess = {
  load(): Promise<GoogleValidationEvidenceSnapshot>;
};

type DrizzleDb = typeof defaultDb;

function websiteDomain(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export class PostgresGoogleValidationEvidenceRepository implements EvidenceAccess {
  constructor(private readonly database: DrizzleDb = defaultDb) {}

  async load(): Promise<GoogleValidationEvidenceSnapshot> {
    const [contactRows, organizationRows] = await Promise.all([
      this.database
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
        })
        .from(contacts),
      this.database
        .select({
          id: organizations.id,
          name: organizations.name,
          website: organizations.website,
          consolidatedIntoId: organizations.consolidatedIntoId,
        })
        .from(organizations),
    ]);

    const liveOrganizations = organizationRows.filter(
      (organization) => organization.consolidatedIntoId === null,
    );

    return {
      contacts: contactRows.flatMap((contact) => {
        const email = contact.email?.trim().toLowerCase();
        if (!email) return [];
        const name = `${contact.firstName} ${contact.lastName}`.trim() || email;
        return [{ id: contact.id, name, emails: [email] }];
      }),
      organizations: liveOrganizations.map((organization) => {
        const domain = websiteDomain(organization.website);
        return {
          id: organization.id,
          name: organization.name,
          domains: domain ? [domain] : [],
        };
      }),
      profiles: liveOrganizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
      })),
    };
  }
}

function toRow(
  message: GoogleMessageMetadata,
  evidenceCodes: string[],
  candidates: GoogleRelevanceCandidate[],
): GoogleValidationRow {
  return {
    id: message.id,
    threadId: message.threadId,
    subject: message.headers.subject,
    from: message.headers.from,
    to: message.headers.to,
    date: message.headers.date,
    internalDateMs: message.internalDateMs,
    labelIds: message.labelIds,
    hasAttachments: message.hasAttachments,
    evidenceCodes,
    candidates,
  };
}

export class GoogleRecentValidationService {
  private readonly connection: ConnectionAccess;
  private readonly scope: ScopeAccess;
  private readonly evidence: EvidenceAccess;

  constructor(options?: {
    connection?: ConnectionAccess;
    scope?: ScopeAccess;
    evidence?: EvidenceAccess;
  }) {
    this.connection = options?.connection ?? new PostgresGoogleConnectionRepository();
    this.scope = options?.scope ?? new GoogleScopeService();
    this.evidence = options?.evidence ?? new PostgresGoogleValidationEvidenceRepository();
  }

  async run(limit = 100): Promise<GoogleRecentValidationResult> {
    const checkedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const client = await this.connection.createReadClient();
    if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    if (!client.listRecentMessageRefs || !client.getMessageMetadata) {
      throw new Error("GOOGLE_WORKSPACE_VALIDATION_UNAVAILABLE");
    }

    const [savedScope, evidenceSnapshot] = await Promise.all([
      this.scope.getSaved(),
      this.evidence.load(),
    ]);
    const approvedLabelIds = new Set(savedScope.labels.map((label) => label.id));
    const refs = await client.listRecentMessageRefs(checkedLimit);

    const matched: GoogleValidationRow[] = [];
    const needsReview: GoogleValidationRow[] = [];
    const ignored: GoogleValidationRow[] = [];

    for (const ref of refs) {
      const message = await client.getMessageMetadata(ref.id);
      const result = classifyGoogleMessageRelevance({
        message,
        evidence: {
          approvedLabelIds,
          contacts: evidenceSnapshot.contacts,
          organizations: evidenceSnapshot.organizations,
          profiles: evidenceSnapshot.profiles,
          existingThreadTarget: null,
        },
      });
      const row = toRow(message, result.evidenceCodes, result.candidates);
      if (result.status === "matched") matched.push(row);
      else if (result.status === "review") needsReview.push(row);
      else ignored.push(row);
    }

    return {
      checkedLimit,
      aiEnabled: false,
      historicalImportStarted: false,
      counts: {
        discovered: refs.length,
        matched: matched.length,
        needsReview: needsReview.length,
        ignored: ignored.length,
      },
      matched,
      needsReview,
      ignored,
    };
  }
}
