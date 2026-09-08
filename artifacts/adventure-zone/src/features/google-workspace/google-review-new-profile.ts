import { apiFetch } from "@/lib/auth-token";
import {
  resolveGoogleWorkspaceValidationReview,
  type GoogleProfileLabelSyncResult,
  type GoogleValidationReviewItem,
} from "./google-workspace-client";

export type GoogleReviewNewProfileInput = {
  profileName: string;
  city: string;
  region: string;
  contactName: string;
  contactEmail: string;
};

function parseHeader(value: string): { name: string; email: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) {
    return trimmed.includes("@")
      ? { name: "", email: trimmed.replace(/^"|"$/g, "") }
      : { name: trimmed.replace(/^"|"$/g, ""), email: "" };
  }
  return {
    name: match[1].trim().replace(/^"|"$/g, ""),
    email: match[2].trim(),
  };
}

function profileNameFromSender(senderName: string, subject: string): string {
  const parts = senderName
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1];
  if (senderName.trim()) return senderName.trim();
  return subject.trim() || "New opportunity";
}

export function suggestedGoogleReviewProfile(
  item: Pick<GoogleValidationReviewItem, "from" | "subject">,
): GoogleReviewNewProfileInput {
  const sender = parseHeader(item.from);
  return {
    profileName: profileNameFromSender(sender.name, item.subject),
    city: "",
    region: "",
    contactName: sender.name,
    contactEmail: sender.email,
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `API ${response.status}`;
    throw new Error(error);
  }
  return body as T;
}

export async function createGoogleReviewNewProfile(
  item: Pick<GoogleValidationReviewItem, "messageId" | "subject">,
  input: GoogleReviewNewProfileInput,
): Promise<{
  id: string;
  name: string;
  gmailSync: GoogleProfileLabelSyncResult;
}> {
  const profileName = input.profileName.trim();
  if (!profileName) throw new Error("Add a profile name.");
  const region = input.region.trim().toUpperCase();
  if (region && region.length !== 2) throw new Error("Use a two-letter state when a state is entered.");

  const contacts =
    input.contactName.trim() || input.contactEmail.trim()
      ? [{
          id: null,
          name: input.contactName.trim() || input.contactEmail.trim(),
          phone: "",
          email: input.contactEmail.trim().toLowerCase(),
          role: "Email contact",
          primary: true,
        }]
      : [];

  const created = await responseJson<{ ok: boolean; profileId: string }>(
    await apiFetch("/event-profiles", {
      method: "POST",
      body: JSON.stringify({
        event: {
          id: null,
          name: profileName,
          city: input.city.trim(),
          region,
        },
        profile: {
          placeType: "other",
          description: `New opportunity created from Gmail review: ${item.subject.trim() || "(No subject)"}`,
          phone: "",
          website: "",
          address1: "",
          address2: "",
          postalCode: "",
        },
        contacts,
        booking: {
          enabled: false,
          name: "",
          status: "new_lead",
          startsAt: "",
          endsAt: "",
          nextActionKind: "",
          nextActionDueAt: "",
          travelLegId: null,
        },
        familyId: null,
        parentOrganizationId: null,
      }),
    }),
  );

  const assignment = await resolveGoogleWorkspaceValidationReview(
    item.messageId,
    created.profileId,
  );
  return {
    id: created.profileId,
    name: profileName,
    gmailSync: assignment.gmailSync,
  };
}
