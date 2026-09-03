import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebsiteInquiryApi } from "./website-inquiry-api";
import { WebsiteInquiryDetail } from "./website-inquiry-detail";

const inquiry = {
  id: "20000000-0000-4000-8000-000000000002",
  submissionId: "10000000-0000-4000-8000-000000000002",
  referenceCode: "AZ-1002",
  status: "new" as const,
  name: "Desie Leigh",
  email: "desie@example.com",
  eventName: "Summer Festival",
  eventDate: "2026-07-04",
  eventLocation: "Denver, CO",
  packageInterest: "Full Adventure",
  message: "Please bring the climbing wall and the obstacle course.",
  pageUrl: "https://the-adventure-zone.com/contact",
  sourceOrigin: "https://the-adventure-zone.com",
  reviewedByKind: null,
  reviewedById: null,
  reviewedByName: null,
  reviewedAt: null,
  convertedContactId: null,
  convertedOrganizationId: null,
  convertedBookingId: null,
  convertedAt: null,
  alertState: "sent" as const,
  alertAttemptCount: 1,
  alertLastAttemptAt: "2026-03-02T10:01:00.000Z",
  alertFailureReason: null,
  alertDeliveredRecipients: ["owner@example.com"],
  createdAt: "2026-03-02T10:00:00.000Z",
  updatedAt: "2026-03-02T10:00:00.000Z",
};

function renderDetail(api: WebsiteInquiryApi, onChanged = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { onChanged, ...render(
    <QueryClientProvider client={client}>
      <WebsiteInquiryDetail api={api} inquiryId={inquiry.id} onChanged={onChanged} />
    </QueryClientProvider>,
  ) };
}

afterEach(cleanup);

describe("WebsiteInquiryDetail", () => {
  it("loads the full message, alert state, audit history, and explained suggestions", async () => {
    const get = vi.fn((path: string) => {
      if (path.endsWith("/matches")) return Promise.resolve({
        contacts: [{ id: "c1", label: "Desie Leigh", score: 115, reasons: ["Exact email match"], context: { email: "desie@example.com" } }],
        organizations: [{ id: "o1", label: "Summer Festival", score: 100, reasons: ["Exact normalized event name match"], context: { city: "Denver", region: "CO" } }],
        parsedLocation: { city: "Denver", region: "CO" },
      });
      return Promise.resolve({ inquiry, auditHistory: [{ id: "a1", action: "received", before: null, after: {}, createdAt: inquiry.createdAt }] });
    });
    renderDetail({ get, patch: vi.fn(), post: vi.fn() } as WebsiteInquiryApi);
    expect(await screen.findByText(inquiry.message)).toBeInTheDocument();
    expect(screen.getByText(/alert sent/i)).toBeInTheDocument();
    expect(screen.getByText(/exact email match/i)).toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "History" }).parentElement!).getByText(/^received$/i)).toBeInTheDocument();
  });

  it("begins review and announces the saved state", async () => {
    const api = {
      get: vi.fn((path: string) => path.endsWith("/matches")
        ? Promise.resolve({ contacts: [], organizations: [], parsedLocation: null })
        : Promise.resolve({ inquiry, auditHistory: [] })),
      patch: vi.fn().mockResolvedValue({ ...inquiry, status: "reviewing" }),
      post: vi.fn(),
    } as WebsiteInquiryApi;
    const { onChanged } = renderDetail(api);
    fireEvent.click(await screen.findByRole("button", { name: /begin review/i }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`/website-inquiries/${inquiry.id}/status`, { action: "begin_review" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/moved to reviewing/i);
    expect(onChanged).toHaveBeenCalled();
  });

  it("links converted records to their CRM destinations", async () => {
    const converted = {
      ...inquiry,
      status: "converted" as const,
      convertedContactId: "10000000-0000-4000-8000-000000000001",
      convertedOrganizationId: "30000000-0000-4000-8000-000000000001",
      convertedBookingId: "40000000-0000-4000-8000-000000000001",
    };
    const api = {
      get: vi.fn((path: string) => path.endsWith("/matches")
        ? Promise.resolve({ contacts: [], organizations: [], parsedLocation: null })
        : Promise.resolve({ inquiry: converted, auditHistory: [] })),
      patch: vi.fn(), post: vi.fn(),
    } as WebsiteInquiryApi;
    renderDetail(api);
    expect(await screen.findByRole("link", { name: /open contact/i })).toHaveAttribute("href", `/contacts/${converted.convertedContactId}`);
    expect(screen.getByRole("link", { name: /open profile/i })).toHaveAttribute("href", `/profiles/${converted.convertedOrganizationId}`);
    expect(screen.getByRole("link", { name: /open booking/i })).toHaveAttribute("href", `/bookings/${converted.convertedBookingId}`);
  });
});
