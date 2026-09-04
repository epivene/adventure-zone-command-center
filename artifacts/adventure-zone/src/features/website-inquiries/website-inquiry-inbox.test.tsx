import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebsiteInquiryApi } from "./website-inquiry-api";
import { WebsiteInquiryInbox } from "./website-inquiry-inbox";

const older = {
  id: "20000000-0000-4000-8000-000000000001",
  referenceCode: "AZ-1001",
  status: "new" as const,
  name: "Older Contact",
  email: "older@example.com",
  eventName: "Spring Fair",
  eventDate: "2026-04-01",
  eventLocation: "Boulder, CO",
  packageInterest: "Classic",
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
  alertLastAttemptAt: "2026-03-01T10:00:00.000Z",
  alertFailureReason: null,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
};
const newest = {
  ...older,
  id: "20000000-0000-4000-8000-000000000002",
  referenceCode: "AZ-1002",
  name: "Newest Contact",
  eventName: "Summer Festival",
  createdAt: "2026-03-02T10:00:00.000Z",
  updatedAt: "2026-03-02T10:00:00.000Z",
};

function renderInbox(api: WebsiteInquiryApi) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WebsiteInquiryInbox api={api} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("WebsiteInquiryInbox", () => {
  it("shows a loading state, newest-first rows, and status tabs", async () => {
    let resolveList!: (value: unknown) => void;
    const list = new Promise((resolve) => {
      resolveList = resolve;
    });
    const api: WebsiteInquiryApi = {
      get: vi.fn((path) =>
        path === "/website-inquiries/count"
          ? Promise.resolve({ newCount: 2 })
          : list,
      ) as WebsiteInquiryApi["get"],
      patch: vi.fn(),
      post: vi.fn(),
    };
    renderInbox(api);
    expect(screen.getByRole("status")).toHaveTextContent(/loading inquiries/i);
    resolveList({ items: [older, newest], nextCursor: null });
    const table = await screen.findByRole("table", {
      name: /website inquiries/i,
    });
    const rows = within(table).getAllByRole("button");
    expect(rows[0]).toHaveTextContent("Newest Contact");
    expect(rows[1]).toHaveTextContent("Older Contact");

    fireEvent.click(screen.getByRole("button", { name: "Reviewing" }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/website-inquiries?status=reviewing&limit=25",
      ),
    );
  });

  it("shows an empty state and recovers from a load error with Retry", async () => {
    let listAttempts = 0;
    const get = vi.fn((path: string) => {
      if (path === "/website-inquiries/count")
        return Promise.resolve({ newCount: 0 });
      listAttempts += 1;
      return listAttempts === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ items: [], nextCursor: null });
    });
    const api = { get, patch: vi.fn(), post: vi.fn() } as WebsiteInquiryApi;
    renderInbox(api);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not load/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText(/no new inquiries/i)).toBeInTheDocument();
  });

  it("expands the selected inquiry immediately after the row that was clicked", async () => {
    window.history.replaceState({}, "", "/website-inquiries");
    const inquiry = {
      ...newest,
      submissionId: "10000000-0000-4000-8000-000000000002",
      message: "Please bring the climbing wall and the obstacle course.",
      pageUrl: "https://the-adventure-zone.com/contact",
      sourceOrigin: "https://the-adventure-zone.com",
      alertDeliveredRecipients: ["owner@example.com"],
    };
    const get = vi.fn((path: string) => {
      if (path === "/website-inquiries/count")
        return Promise.resolve({ newCount: 2 });
      if (path === `/website-inquiries/${newest.id}/matches`) {
        return Promise.resolve({
          contacts: [],
          organizations: [],
          parsedLocation: null,
        });
      }
      if (path === `/website-inquiries/${newest.id}`) {
        return Promise.resolve({ inquiry, auditHistory: [] });
      }
      return Promise.resolve({ items: [older, newest], nextCursor: null });
    });
    renderInbox({ get, patch: vi.fn(), post: vi.fn() } as WebsiteInquiryApi);

    const selectedButton = await screen.findByRole("button", {
      name: /Newest Contact/,
    });
    fireEvent.click(selectedButton);

    const detail = await screen.findByRole("region", {
      name: "Selected inquiry",
    });
    const selectedRow = selectedButton.closest("tr");
    expect(selectedRow).not.toBeNull();
    expect(selectedRow?.nextElementSibling).toContainElement(detail);
    expect(
      await within(detail).findByText(inquiry.message),
    ).toBeInTheDocument();
  });
});
