import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiGet, navigate } = vi.hoisted(() => ({ apiGet: vi.fn(), navigate: vi.fn() }));
const contactId = "20000000-0000-4000-8000-000000000001";

vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("@/components/contacts/sync-state-badge", () => ({ SyncStateBadge: () => null }));
vi.mock("@/components/activities/activity-timeline", () => ({ ActivityTimeline: () => null }));
vi.mock("@/components/assistant/assistant-context-registration", () => ({ AssistantContextRegistration: () => null }));
vi.mock("@/features/assistant/assistant-context", () => ({ useAssistantContext: () => ({ openAssistant: vi.fn() }) }));
vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(),
  loadTimelinePageAction: vi.fn(),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/contacts/test", navigate],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import ContactDetailPage from "./ContactDetailPage";

function detail(doNotCallAt: string | null, places: any[] = []) {
  return {
    assistedCallingEnabled: true,
    contact: { firstName: "Sarah", lastName: "Miller", syncState: "unlinked" },
    phones: [{
      id: "phone-1",
      contactId,
      number: "303-555-0100",
      normalizedNumber: "+13035550100",
      type: "mobile",
      extension: null,
      label: "Mobile",
      primary: true,
      source: "manual",
      doNotCallAt,
      doNotCallReason: doNotCallAt ? "Requested" : null,
    }],
    places,
    relatedBookings: [],
    timeline: [],
  };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  navigate.mockReset();
});

describe("ContactDetailPage", () => {
  it("opens a linked contact on its own profile", async () => {
    apiGet.mockResolvedValue(detail(null, [{ id: "profile-1", name: "Example Event", isPrimaryPlace: true }]));
    render(<ContactDetailPage contactId={contactId} />);

    expect(await screen.findByRole("heading", { name: "Sarah Miller" })).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps the standalone fallback for an unlinked contact", async () => {
    apiGet.mockResolvedValue(detail(null));
    render(<ContactDetailPage contactId={contactId} />);

    expect(await screen.findByRole("heading", { name: "Sarah Miller" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Call" })).toHaveAttribute("href", `/calls/workspace?contactId=${contactId}`);
    expect(screen.getByRole("link", { name: "Log call" })).toHaveAttribute("href", `/calls/log?contactId=${contactId}`);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("suppresses calling for a Do Not Call number but keeps historical logging", async () => {
    apiGet.mockResolvedValue(detail("2026-08-12T12:00:00.000Z"));
    render(<ContactDetailPage contactId={contactId} />);

    expect(await screen.findByRole("button", { name: "Call" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Call" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log call" })).toHaveAttribute("href", `/calls/log?contactId=${contactId}`);
    expect(screen.queryByRole("link", { name: "303-555-0100" })).not.toBeInTheDocument();
  });
});
