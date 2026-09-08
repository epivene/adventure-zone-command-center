/**
 * Source-contract tests for the marketing campaign workspace.
 *
 * Since the page is split into feature modules, each test reads from the most
 * specific file that owns the contract being tested. The page shell
 * (MarketingCampaignsPage.tsx) wires everything together; its tests confirm
 * the modules are imported and the tabs are rendered.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = resolve(__dirname, "../features/marketing");

const shell = readFileSync(resolve(__dirname, "MarketingCampaignsPage.tsx"), "utf8");
const types = readFileSync(resolve(root, "types.ts"), "utf8");
const audienceForm = readFileSync(resolve(root, "AudienceForm.tsx"), "utf8");
const audiencesTab = readFileSync(resolve(root, "AudiencesTab.tsx"), "utf8");
const campaignHistory = readFileSync(resolve(root, "CampaignHistory.tsx"), "utf8");
const campaignActions = readFileSync(resolve(root, "CampaignActions.tsx"), "utf8");
const emailTab = readFileSync(resolve(root, "EmailCampaignsTab.tsx"), "utf8");
const promosTab = readFileSync(resolve(root, "PromosTab.tsx"), "utf8");

// Convenience: search all feature files
const allFeatures = [audienceForm, audiencesTab, campaignHistory, campaignActions, emailTab, promosTab, types];
const allSources = [shell, ...allFeatures];

// ─── No local-storage campaign persistence ────────────────────────────────────

describe("No localStorage campaign/audience persistence", () => {
  it("does not define a STORAGE_KEY constant for campaigns", () => {
    allSources.forEach((s) => expect(s).not.toContain("adventure-zone-marketing-campaigns-v1"));
  });

  it("does not use localStorage to read or write campaigns or audiences", () => {
    allSources.forEach((s) => {
      expect(s).not.toContain('"adventure-zone-campaigns');
      expect(s).not.toContain('"adventure-zone-audiences');
      expect(s).not.toContain("STORAGE_KEY");
    });
  });

  it("does not have a readState() function that reads campaign state from storage", () => {
    allSources.forEach((s) => expect(s).not.toContain("function readState()"));
  });

  it("does not use fake Mark-sent behavior via setState", () => {
    allSources.forEach((s) => {
      expect(s).not.toContain('"status":"sent"');
      expect(s).not.toContain('status: "sent"');
      expect(s).not.toContain("Mark sent");
      expect(s).not.toContain("mark sent");
    });
  });
});

// ─── Real API paths ───────────────────────────────────────────────────────────

describe("Uses real durable API paths", () => {
  it("fetches audiences from /marketing/audiences", () => {
    const combined = allFeatures.join("\n");
    expect(combined).toContain("/marketing/audiences");
  });

  it("fetches templates from /marketing/templates", () => {
    expect(emailTab).toContain("/marketing/templates");
  });

  it("fetches campaigns from /marketing/campaigns", () => {
    expect(campaignHistory).toContain("/marketing/campaigns");
  });

  it("posts new campaigns to /marketing/campaigns", () => {
    expect(emailTab).toContain('apiPost("/marketing/campaigns"');
  });

  it("does not generate fake campaign IDs as Campaign objects client-side", () => {
    allSources.forEach((s) => {
      expect(s).not.toContain("id: crypto.randomUUID(), name: name.trim(), subject");
      expect(s).not.toContain('status: "draft", createdAt: new Date()');
    });
  });

  it("calls preflight endpoint per audience", () => {
    expect(audiencesTab).toContain("/preflight");
  });

  it("uses apiPost for all mutation campaign actions", () => {
    const combined = [campaignHistory, campaignActions].join("\n");
    expect(combined).toContain("apiPost(`/marketing/campaigns/${");
    expect(combined).toContain("request-review");
    expect(combined).toContain("approve");
    expect(combined).toContain("send-now");
    expect(combined).toContain("send-test");
    expect(combined).toContain("cancel");
    expect(combined).toContain("retry");
  });

  it("uses apiPatch for audience updates", () => {
    expect(audienceForm).toContain("apiPatch");
    expect(audienceForm).toContain("/marketing/audiences/");
  });

  it("uses apiDelete for audience deletion", () => {
    expect(audiencesTab).toContain("apiDelete");
    expect(audiencesTab).toContain("/marketing/audiences/${");
  });
});

// ─── records response field ───────────────────────────────────────────────────

describe("GET /organizations response shape — uses records not organizations", () => {
  it("reads data.records from GET /organizations, not data.organizations", () => {
    // The response shape is { total, records }
    expect(audienceForm).toContain("data.records");
    expect(audienceForm).not.toContain("data.organizations");
  });

  it("types the response as { total: number; records: OrgRecord[] }", () => {
    expect(audienceForm).toContain("total: number");
    expect(audienceForm).toContain("records: OrgRecord[]");
  });

  it("defines OrgRecord type in types.ts", () => {
    expect(types).toContain("OrgRecord");
    expect(types).toContain("type OrgRecord");
  });
});

// ─── Audience detail load before edit save ────────────────────────────────────

describe("Editing audience loads existing members from server before Save is allowed", () => {
  it("calls GET /marketing/audiences/:id when editing", () => {
    expect(audienceForm).toContain("/marketing/audiences/${existing.id}");
  });

  it("reads members from AudienceDetail response", () => {
    expect(audienceForm).toContain("data.members");
    expect(types).toContain("AudienceMemberDetail");
  });

  it("shows a loading state while existing members are being fetched", () => {
    expect(audienceForm).toContain("membersLoading");
    expect(audienceForm).toContain("members-loading");
    expect(audienceForm).toContain("Loading existing members");
  });

  it("blocks Save button until existing members have loaded", () => {
    expect(audienceForm).toContain("saveBlocked");
    expect(audienceForm).toContain("membersLoading || !!membersError");
    expect(audienceForm).toContain("disabled={!name.trim() || saving || saveBlocked}");
  });

  it("shows a member-load error state that prevents saving", () => {
    expect(audienceForm).toContain("membersError");
    expect(audienceForm).toContain("members-load-error");
    expect(audienceForm).toContain("Resolve this before saving");
  });

  it("preserves loaded members in local state", () => {
    // After loading, members should be set; user can only remove explicitly
    expect(audienceForm).toContain("setMembers(loaded)");
  });
});

// ─── Exact contact selection (no auto-picking) ────────────────────────────────

describe("Contact selection — user chooses exact contacts, no auto-pick of primary", () => {
  it("shows a ContactPicker component after clicking an org", () => {
    expect(audienceForm).toContain("ContactPicker");
    expect(audienceForm).toContain("function ContactPicker");
  });

  it("loads all email-bearing contacts from GET /organizations/:id", () => {
    expect(audienceForm).toContain("/organizations/${orgId}");
    expect(audienceForm).toContain("c.email?.trim()");
  });

  it("renders each contact as a selectable checkbox option", () => {
    expect(audienceForm).toContain("contact-option-${c.id}");
    expect(audienceForm).toContain('type="checkbox"');
  });

  it("does NOT auto-pick the primary contact", () => {
    // The old code: const primary = withEmail.find(c => c.isPrimary) ?? withEmail[0]!
    // That pattern must not exist
    expect(audienceForm).not.toContain("withEmail.find((c) => c.isPrimary) ?? withEmail[0]");
    expect(audienceForm).not.toContain("find((c) => c.isPrimary) ?? withEmail[0]");
  });

  it("allows adding multiple contacts from the same organization", () => {
    // onContactsPicked receives an array of SelectedMember
    expect(audienceForm).toContain("SelectedMember[]");
    expect(audienceForm).toContain("onPick(members)");
    expect(audienceForm).toContain("newMembers.filter");
  });
});

// ─── Composite member keys (organizationId + contactId) ──────────────────────

describe("Composite member key = organizationId + contactId, not organizationId alone", () => {
  it("defines a memberKey() function that combines both IDs", () => {
    expect(types).toContain("function memberKey");
    expect(types).toContain("organizationId: string, contactId: string");
    expect(types).toContain("`${organizationId}::${contactId}`");
  });

  it("imports and uses memberKey in AudienceForm", () => {
    expect(audienceForm).toContain("memberKey");
    expect(audienceForm).toContain("memberKey(m.organizationId, m.contactId)");
  });

  it("uses composite key for selected members deduplication", () => {
    expect(audienceForm).toContain("members.map((m) => memberKey(m.organizationId, m.contactId))");
  });

  it("removes members by composite key, not by organizationId alone", () => {
    expect(audienceForm).toContain("removeMember(m.organizationId, m.contactId)");
    // Old pattern (organizationId only) must be gone
    expect(audienceForm).not.toContain("prev.filter((m) => m.organizationId !== organizationId)");
  });

  it("member data-testid uses composite organizationId+contactId", () => {
    expect(audienceForm).toContain("selected-member-${m.organizationId}-${m.contactId}");
  });

  it("remove button data-testid uses composite key", () => {
    expect(audienceForm).toContain("remove-member-${m.organizationId}-${m.contactId}");
  });
});

// ─── Audience confirmation / preflight ───────────────────────────────────────

describe("Audience preflight and confirmation", () => {
  it("shows preflight eligible and excluded counts", () => {
    expect(audiencesTab).toContain("eligible");
    expect(audiencesTab).toContain("excluded");
  });

  it("renders the preflight panel component", () => {
    expect(audiencesTab).toContain("PreflightPanel");
  });

  it("sends audience members with both organizationId and contactId", () => {
    expect(audienceForm).toContain("organizationId: m.organizationId");
    expect(audienceForm).toContain("contactId: m.contactId");
  });

  it("fetches real contact IDs from org detail before adding to audience", () => {
    expect(audienceForm).toContain("/organizations/${orgId}");
    // Contacts are fetched and listed — no auto-assign
    expect(audienceForm).toContain("contacts ?? []");
  });

  it("filters to contacts with email when building members", () => {
    expect(audienceForm).toContain("hasEmail");
  });

  it("shows exclusion reasons from preflight", () => {
    const combined = [audiencesTab, types].join("\n");
    expect(combined).toContain("exclusionReasonLabel");
    expect(combined).toContain("inactive_organization");
    expect(combined).toContain("communication_block");
  });
});

// ─── Test-send isolation ──────────────────────────────────────────────────────

describe("Test-send isolation", () => {
  it("renders a separate TestSendButton component", () => {
    expect(campaignActions).toContain("TestSendButton");
  });

  it("prompts for an explicit test address", () => {
    expect(campaignActions).toContain("test-send-address-input");
    expect(campaignActions).toContain("address.trim()");
  });

  it("posts to the /send-test endpoint, not /send-now", () => {
    expect(campaignActions).toContain("/send-test");
  });

  it("does not affect real audience send", () => {
    expect(campaignActions).toContain("Sends a rendered copy to a single test address only");
    // The phrase may be split across JSX lines; check key fragments separately
    expect(campaignActions).toContain("does not affect the");
    expect(campaignActions).toContain("real audience or campaign state");
  });
});

// ─── Workflow controls ────────────────────────────────────────────────────────

describe("Valid workflow controls", () => {
  it("shows all campaign state labels", () => {
    const combined = [types, campaignHistory].join("\n");
    expect(combined).toContain("draft");
    expect(combined).toContain("needs_review");
    expect(combined).toContain("approved");
    expect(combined).toContain("scheduled");
    expect(combined).toContain("sending");
    expect(combined).toContain("sent");
    expect(combined).toContain("failed");
    expect(combined).toContain("cancelled");
  });

  it("gates request-review to draft and needs_review states", () => {
    expect(campaignHistory).toContain('state === "draft" || state === "needs_review"');
  });

  it("gates approve to needs_review state", () => {
    expect(campaignHistory).toContain('state === "needs_review"');
  });

  it("gates send-now to approved state", () => {
    expect(campaignHistory).toContain('state === "approved"');
  });

  it("gates retry to failed state", () => {
    expect(campaignHistory).toContain('state === "failed"');
  });

  it("requires confirmation dialog before real audience send", () => {
    expect(campaignActions).toContain("Confirm real audience send");
    expect(campaignActions).toContain("send-confirm-btn");
  });

  it("shows final recipient count in the send confirmation dialog", () => {
    expect(campaignActions).toContain("recipientCount");
    expect(campaignActions).toContain("confirmed recipient");
  });

  it("shows return-for-changes control with required note", () => {
    expect(campaignActions).toContain("return-for-changes");
    expect(campaignActions).toContain("return-note-input");
  });

  it("shows schedule control with datetime input", () => {
    expect(campaignActions).toContain("schedule-datetime-input");
    expect(campaignActions).toContain("schedule-confirm-btn");
  });

  it("cancels are available for pre-send states", () => {
    expect(campaignHistory).toContain('"draft", "needs_review", "approved", "scheduled", "failed"');
  });
});

// ─── Loading, empty, and error states ────────────────────────────────────────

describe("Robust state handling", () => {
  it("shows skeleton loading states", () => {
    const combined = allFeatures.join("\n");
    expect(combined).toContain("Skeleton");
  });

  it("shows an error state with retry for API failures", () => {
    const combined = [audiencesTab, campaignHistory, emailTab].join("\n");
    expect(combined).toContain("ErrorState");
    expect(combined).toContain("onRetry");
  });

  it("shows empty states when no data exists", () => {
    expect(audiencesTab).toContain("No audiences yet");
    expect(campaignHistory).toContain("No campaigns yet");
  });

  it("refreshes after mutations", () => {
    expect(campaignHistory).toContain("onRefreshAll");
    expect(campaignHistory).toContain("fetchCampaigns");
    expect(audiencesTab).toContain("fetchAudiences");
  });
});

// ─── Module split ─────────────────────────────────────────────────────────────

describe("Feature module split", () => {
  it("page shell imports AudiencesTab", () => {
    expect(shell).toContain("AudiencesTab");
  });

  it("page shell imports CampaignHistoryTab", () => {
    expect(shell).toContain("CampaignHistoryTab");
  });

  it("page shell imports EmailCampaignsTab", () => {
    expect(shell).toContain("EmailCampaignsTab");
  });

  it("page shell imports PromosTab", () => {
    expect(shell).toContain("PromosTab");
  });

  it("types are centralised in types.ts", () => {
    expect(types).toContain("ServerAudience");
    expect(types).toContain("CampaignSummary");
    expect(types).toContain("AudienceMemberDetail");
    expect(types).toContain("memberKey");
  });
});

// ─── Promos: clearly scoped as browser-local ─────────────────────────────────

describe("Promos clearly disclosed as browser-local", () => {
  it("uses a separate PROMO_KEY distinct from campaigns", () => {
    expect(types).toContain("adventure-zone-promos-v1");
  });

  it("discloses browser-local storage in the UI", () => {
    expect(promosTab).toContain("Browser-local storage only");
    expect(promosTab).toContain("stored locally in this browser only");
  });

  it("does not mix promo state with server campaign state", () => {
    expect(promosTab).toContain("readPromos()");
    expect(promosTab).toContain("writePromos(promos)");
  });
});
