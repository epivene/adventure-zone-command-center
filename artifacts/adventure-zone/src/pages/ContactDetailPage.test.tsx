import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const contactId = "20000000-0000-4000-8000-000000000001";

vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("@/components/contacts/sync-state-badge", () => ({ SyncStateBadge: () => null }));
vi.mock("@/components/activities/activity-timeline", () => ({ ActivityTimeline: () => null }));
vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn(),
  listActivityRevisionsAction: vi.fn(),
}));
vi.mock("wouter", () => ({
  useParams: () => ({ contactId }),
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import ContactDetailPage from "./ContactDetailPage";

function detail(doNotCallAt: string | null) {
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
    relatedBookings: [],
    timeline: [],
  };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("ContactDetailPage call actions", () => {
  it("hides assisted Call and Log call entry points when the flag is off", async () => {
    apiGet.mockResolvedValue({ ...detail(null), assistedCallingEnabled: false });
    render(<ContactDetailPage />);
    expect(await screen.findByText("Assisted calling is not enabled.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Call" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log call" })).not.toBeInTheDocument();
  });

  it("uses the contact ID for Call and Log call", async () => {
    apiGet.mockResolvedValue(detail(null));
    render(<ContactDetailPage />);

    expect(await screen.findByRole("link", { name: "Call" })).toHaveAttribute("href", `/calls/new?contactId=${contactId}`);
    expect(screen.getByRole("link", { name: "Log call" })).toHaveAttribute("href", `/calls/log?contactId=${contactId}`);
  });

  it("suppresses calling for a Do Not Call number but keeps historical logging", async () => {
    apiGet.mockResolvedValue(detail("2026-08-12T12:00:00.000Z"));
    render(<ContactDetailPage />);

    expect(await screen.findByRole("button", { name: "Call" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Call" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log call" })).toHaveAttribute("href", `/calls/log?contactId=${contactId}`);
    expect(screen.queryByRole("link", { name: "303-555-0100" })).not.toBeInTheDocument();
  });
});
