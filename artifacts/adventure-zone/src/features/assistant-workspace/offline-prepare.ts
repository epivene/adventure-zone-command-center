import { apiFetch } from "@/lib/auth-token";
import {
  isOfflineShellReady,
  prepareOfflineShell,
} from "@/lib/offline/workspace-shell";
import { workspaceApi } from "./api";
import type { Conversation, Rule } from "./types";
import {
  assertOfflineBinding,
  commitPreparedSnapshot,
  getOfflineBinding,
  loadOfflineWorkspace,
  type OfflineProfile,
  type OfflineSnapshot,
} from "./offline-store";
function listSummary(value: unknown, fields: string[]): string {
  if (!Array.isArray(value)) return "None in this snapshot";
  return (
    value
      .map((item) =>
        fields
          .map((field) => item?.[field])
          .filter(
            (entry) => typeof entry === "string" || typeof entry === "number",
          )
          .join(" · "),
      )
      .filter(Boolean)
      .join("\n") || "None in this snapshot"
  );
}
export async function prepareOfflineWorkspace(
  conversationId: string,
  progress?: (message: string) => void,
): Promise<OfflineSnapshot> {
  const binding = await getOfflineBinding();
  progress?.("Verifying your online sign-in…");
  const response = await apiFetch("/auth/me");
  if (!response.ok)
    throw new Error(
      "Sign in online as the owner before preparing this device.",
    );
  const identity = await response.json();
  if (identity.ok !== true || identity.role !== "owner")
    throw new Error(
      "Sign in online as the owner before preparing this device.",
    );
  assertOfflineBinding(binding);
  progress?.("Saving the current conversation, profiles and rules…");
  const conversation = await workspaceApi<Conversation>(
    `/conversations/${encodeURIComponent(conversationId)}`,
  );
  assertOfflineBinding(binding);
  if (
    conversation.id !== conversationId ||
    !Array.isArray(conversation.drafts) ||
    !Array.isArray(conversation.selection?.organizationIds)
  )
    throw new Error(
      "The current conversation could not be verified. Try again online.",
    );
  const organizationIds = [...new Set(conversation.selection.organizationIds)];
  const [rules, profiles] = await Promise.all([
    workspaceApi<Rule[]>("/knowledge"),
    Promise.all(
      organizationIds.map(async (id): Promise<OfflineProfile> => {
        assertOfflineBinding(binding);
        const result = await apiFetch(
          `/organizations/${encodeURIComponent(id)}`,
        );
        if (result.status === 404)
          return {
            id,
            name: "Unavailable selected profile",
            details: {
              Note: "This profile was unavailable when prepared. Review it online.",
            },
          };
        if (!result.ok)
          throw new Error(
            "A selected profile could not be saved. Try preparing again online.",
          );
        const data = await result.json();
        if (data.consolidatedInto)
          return {
            id,
            name: "Merged selected profile",
            details: {
              Note: "This profile was merged. Select its current record online and prepare again.",
            },
          };
        const organization = data.organization;
        if (!organization || typeof organization.name !== "string")
          throw new Error(
            "A selected profile response was incomplete. Prepare again online.",
          );
        // Deliberate text projection excludes photos, screenshots and document bytes.
        return {
          id,
          name: organization.name,
          details: {
            Locations: listSummary(data.orgLocations, [
              "label",
              "venueName",
              "city",
              "region",
            ]),
            Contacts: listSummary(organization.contacts, [
              "name",
              "role",
              "email",
              "phone",
            ]),
            Bookings: listSummary(organization.bookings, [
              "name",
              "startsAt",
              "endsAt",
              "status",
            ]),
            "Contact count":
              organization.contactTotal ?? organization.contacts?.length ?? 0,
            "Booking count":
              organization.bookingTotal ?? organization.bookings?.length ?? 0,
            "Snapshot coverage":
              "The available first page of contacts and bookings. Open online for complete history.",
            ...(organization.lastResortReason
              ? { "Last-resort note": organization.lastResortReason }
              : {}),
          },
        };
      }),
    ),
  ]);
  assertOfflineBinding(binding);
  const today = new Date().toISOString().slice(0, 10);
  const applicableRules = rules.filter(
    (rule) =>
      rule.status === "approved" &&
      (!rule.organizationId || organizationIds.includes(rule.organizationId)) &&
      (rule.eventYear === null ||
        rule.eventYear === conversation.selection.eventYear) &&
      rule.effectiveFrom <= today &&
      (!rule.effectiveTo || rule.effectiveTo >= today),
  );
  progress?.("Downloading the app for offline use…");
  await prepareOfflineShell((completed, total) =>
    progress?.(`Downloading app files: ${completed} of ${total}…`),
  );
  assertOfflineBinding(binding);
  if (!(await isOfflineShellReady()))
    throw new Error(
      "The offline app assets are incomplete. Prepare again while connected.",
    );
  const snapshot = await commitPreparedSnapshot(binding, {
    conversation,
    profiles,
    rules: applicableRules,
  });
  const saved = await loadOfflineWorkspace();
  assertOfflineBinding(binding);
  if (
    !saved.snapshots.some(
      (entry) =>
        entry.conversation.id === conversationId &&
        entry.preparedAt === snapshot.preparedAt,
    ) ||
    !(await isOfflineShellReady())
  )
    throw new Error(
      "Offline preparation could not be verified. Device storage or app assets may have been removed. Try again.",
    );
  assertOfflineBinding(binding);
  return snapshot;
}
