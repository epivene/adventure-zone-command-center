import { commitmentTransaction } from "@/features/outreach-planner/outreach-commitments";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { bookings, contacts, organizationContacts, organizations } from "@/db/schema";
import { patchContactInTransaction } from "@/features/contacts/contact-repository";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { ProfileResearchRepository, type ProfileResearchRun } from "./profile-research-repository";

const placeTypes = new Set([
  "fair", "city_government", "festival_event", "venue", "school", "tribe",
  "association", "company", "other",
]);

export type ProfileResearchApplyResult = {
  applied: string[];
  stale: string[];
  invalid: Array<{ id: string; error: string }>;
  missing: string[];
};

function normalized(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value).trim() || null;
}

function same(left: unknown, right: unknown) {
  return (normalized(left) ?? "").toLowerCase() === (normalized(right) ?? "").toLowerCase();
}

function splitName(value: string) {
  const [firstName, ...rest] = value.trim().split(/\s+/);
  return { firstName: firstName || "", lastName: rest.join(" ") };
}

function validatedValue(field: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("The suggested value is empty.");
  if (field === "website") {
    const parsed = z.url().safeParse(trimmed);
    if (!parsed.success || !/^https?:\/\//i.test(trimmed)) throw new Error("Use a public http(s) website URL.");
  }
  if (field === "email" && !z.email().safeParse(trimmed).success) throw new Error("The suggested email is invalid.");
  if (field === "phone" && !normalizeNorthAmericanPhone(trimmed)) throw new Error("The suggested phone number is invalid.");
  if (field === "region" && !/^[A-Za-z]{2}$/.test(trimmed)) throw new Error("Use a two-letter state/region.");
  if (field === "placeType" && !placeTypes.has(trimmed)) throw new Error("The suggested profile category is not supported.");
  if ((field === "startsAt" || field === "endsAt") && !Number.isFinite(new Date(trimmed).getTime())) throw new Error("The suggested event date is invalid.");
  return field === "region" ? trimmed.toUpperCase() : trimmed;
}

async function currentOrganizationValue(writer: any, profileId: string, field: string) {
  const [row] = await writer.select().from(organizations).where(eq(organizations.id, profileId)).limit(1);
  return row ? (row as any)[field] : undefined;
}

async function currentContact(writer: any, contactId: string) {
  const [row] = await writer.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  return row ?? null;
}

async function currentContactValue(writer: any, profileId: string, contactId: string, field: string) {
  if (field === "role") {
    const [row] = await writer
      .select({ role: organizationContacts.role })
      .from(organizationContacts)
      .where(and(eq(organizationContacts.organizationId, profileId), eq(organizationContacts.contactId, contactId)))
      .limit(1);
    return row?.role;
  }
  const row = await currentContact(writer, contactId);
  if (!row) return undefined;
  if (field === "name") return `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
  return (row as any)[field];
}

async function currentBookingValue(writer: any, bookingId: string, field: string) {
  const [row] = await writer.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return row ? (row as any)[field] : undefined;
}

export class ProfileResearchApplyService {
  constructor(
    private readonly runs = new ProfileResearchRepository(),
    private readonly database = db,
  ) {}

  async apply(input: { profileId: string; runId: string; suggestionIds: string[] }): Promise<ProfileResearchApplyResult> {
    const run = await this.runs.getRun(input.profileId, input.runId);
    if (!run || run.status !== "complete") throw new Error("PROFILE_RESEARCH_RUN_NOT_READY");

    const requested = [...new Set(input.suggestionIds)];
    const byId = new Map(run.suggestions.map((suggestion) => [suggestion.id, suggestion]));
    const result: ProfileResearchApplyResult = { applied: [], stale: [], invalid: [], missing: [] };

    for (const id of requested) {
      const suggestion = byId.get(id);
      if (!suggestion || suggestion.reviewStatus !== "pending") {
        result.missing.push(id);
        continue;
      }

      try {
        const value = validatedValue(suggestion.field, suggestion.suggestedValue);
        const outcome = await commitmentTransaction(this.database, async (tx: any) => {
          if (suggestion.targetKind === "organization") {
            const current = await currentOrganizationValue(tx, input.profileId, suggestion.field);
            if (current === undefined) return "missing" as const;
            if (!same(current, suggestion.currentValue)) return "stale" as const;
            const updates: Record<string, unknown> = { [suggestion.field]: value, updatedAt: new Date() };
            if (suggestion.field === "phone") updates.normalizedPhone = normalizeNorthAmericanPhone(value);
            await tx.update(organizations).set(updates).where(eq(organizations.id, input.profileId));
            return "applied" as const;
          }

          if (!suggestion.targetId) return "missing" as const;

          if (suggestion.targetKind === "contact") {
            const current = await currentContactValue(tx, input.profileId, suggestion.targetId, suggestion.field);
            if (current === undefined) return "missing" as const;
            if (!same(current, suggestion.currentValue)) return "stale" as const;
            if (suggestion.field === "role") {
              await tx.update(organizationContacts)
                .set({ role: value, updatedAt: new Date() })
                .where(and(eq(organizationContacts.organizationId, input.profileId), eq(organizationContacts.contactId, suggestion.targetId)));
            } else {
              const before = await currentContact(tx, suggestion.targetId);
              if (!before) return "missing" as const;
              const updates = suggestion.field === "name" ? splitName(value) : { [suggestion.field]: value };
              await patchContactInTransaction(tx, before, null, updates, new Date(), "local");
            }
            return "applied" as const;
          }

          const current = await currentBookingValue(tx, suggestion.targetId, suggestion.field);
          if (current === undefined) return "missing" as const;
          if (!same(current, suggestion.currentValue)) return "stale" as const;
          const bookingValue = suggestion.field === "startsAt" || suggestion.field === "endsAt" ? new Date(value) : value;
          await tx.update(bookings)
            .set({ [suggestion.field]: bookingValue, updatedAt: new Date() })
            .where(and(eq(bookings.id, suggestion.targetId), eq(bookings.organizationId, input.profileId)));
          return "applied" as const;
        });

        if (outcome === "stale") {
          result.stale.push(id);
        } else if (outcome === "missing") {
          result.missing.push(id);
        } else {
          await this.runs.setSuggestionReview({ profileId: input.profileId, runId: input.runId, suggestionId: id, status: "accepted" });
          result.applied.push(id);
        }
      } catch (error) {
        result.invalid.push({ id, error: error instanceof Error ? error.message : "Could not apply this suggestion." });
      }
    }

    return result;
  }

  async applyAllHighConfidence(input: { profileId: string; runId: string }) {
    const run = await this.runs.getRun(input.profileId, input.runId);
    if (!run || run.status !== "complete") throw new Error("PROFILE_RESEARCH_RUN_NOT_READY");
    const ids = run.suggestions
      .filter((suggestion) => suggestion.reviewStatus === "pending" && suggestion.confidence === "high" && !suggestion.conflict)
      .map((suggestion) => suggestion.id);
    return this.apply({ ...input, suggestionIds: ids });
  }
}
