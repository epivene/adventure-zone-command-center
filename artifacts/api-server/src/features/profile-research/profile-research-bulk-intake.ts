import { parseBusinessDateInput } from "@/lib/business-date";
import { isSafeResearchUrl } from "./profile-research-matching";
import type { RelatedEventOpportunity } from "./profile-research-discovery";
import {
  isResearchProspectValidationError,
  ResearchProspectIntakeService,
  type ResearchProspectSaveInput,
} from "./research-prospect-intake";

export type BulkProspectEvent = RelatedEventOpportunity;

export type BulkProspectCreateInput = {
  events: BulkProspectEvent[];
  nextActionKind: string;
  nextActionDueAt: string;
};

type SingleIntake = Pick<ResearchProspectIntakeService, "create">;

export class ProfileResearchBulkIntakeService {
  constructor(private readonly intake: SingleIntake = new ResearchProspectIntakeService()) {}

  async create(input: BulkProspectCreateInput) {
    if (!input.events.length) throw new Error("BULK_PROSPECT_EMPTY");
    if (input.events.length > 20) throw new Error("BULK_PROSPECT_LIMIT");
    if (!["call", "email", "prepare_quote"].includes(input.nextActionKind)) throw new Error("BULK_PROSPECT_ACTION_REQUIRED");
    if (!parseBusinessDateInput(input.nextActionDueAt)) throw new Error("INVALID_BULK_FOLLOW_UP_DATE");

    const nextActionKind = input.nextActionKind as ResearchProspectSaveInput["nextActionKind"];
    const created: Array<{ name: string; url: string; profileId: string; bookingId: string }> = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const event of input.events) {
      const name = event.name.trim();
      const city = event.city?.trim() ?? "";
      const region = event.region?.trim().toUpperCase() ?? "";
      if (!name || !city || region.length !== 2 || !isSafeResearchUrl(event.url)) {
        skipped.push({ name: name || "Unnamed event", reason: "missing_required_info" });
        continue;
      }

      try {
        const result = await this.intake.create({
          event,
          accepted: {
            name,
            city,
            region,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            website: event.url,
          },
          nextActionKind,
          nextActionDueAt: input.nextActionDueAt,
        });
        if (result.kind === "duplicate") {
          skipped.push({ name, reason: result.match.status });
          continue;
        }
        created.push({ name, url: event.url, profileId: result.profileId, bookingId: result.bookingId });
      } catch (error) {
        if (isResearchProspectValidationError(error)) {
          skipped.push({ name, reason: "missing_required_info" });
          continue;
        }
        throw error;
      }
    }

    return { created, skipped };
  }
}
