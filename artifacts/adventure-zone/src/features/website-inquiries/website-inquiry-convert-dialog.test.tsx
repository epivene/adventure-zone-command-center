import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebsiteInquiryApi } from "./website-inquiry-api";
import { WebsiteInquiryConvertDialog } from "./website-inquiry-convert-dialog";

const inquiry = {
  id: "20000000-0000-4000-8000-000000000002",
  name: "Desie Leigh",
  email: "desie@example.com",
  eventName: "Summer Festival",
  eventDate: "2026-07-04",
  eventLocation: "Denver, CO",
  packageInterest: "Full Adventure",
  message: "Please call me.",
} as const;
const matches = {
  contacts: [{ id: "10000000-0000-4000-8000-000000000001", label: "Desie Leigh", score: 115, reasons: ["Exact email match"], context: { email: "desie@example.com" } }],
  organizations: [{ id: "30000000-0000-4000-8000-000000000001", label: "Summer Festival", score: 100, reasons: ["Exact normalized event name match"], context: { city: "Denver", region: "CO" } }],
  parsedLocation: { city: "Denver", region: "CO" },
};

afterEach(cleanup);

describe("WebsiteInquiryConvertDialog", () => {
  it("prefills inquiry data, selects suggestions, confirms, and returns CRM links", async () => {
    const post = vi.fn().mockResolvedValue({
      inquiryId: inquiry.id,
      contactId: matches.contacts[0].id,
      organizationId: matches.organizations[0].id,
      bookingId: "40000000-0000-4000-8000-000000000001",
      followUpId: "50000000-0000-4000-8000-000000000001",
      alreadyConverted: false,
    });
    const api = { get: vi.fn(), patch: vi.fn(), post } as WebsiteInquiryApi;
    render(<WebsiteInquiryConvertDialog api={api} inquiry={inquiry} matches={matches} onClose={vi.fn()} onConverted={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /use contact desie leigh/i }));
    fireEvent.click(screen.getByRole("button", { name: /use profile summer festival/i }));
    expect(screen.getByLabelText(/booking name/i)).toHaveValue("Summer Festival");
    expect(screen.getByLabelText(/^city/i)).toHaveValue("Denver");
    expect(screen.getByLabelText(/state/i)).toHaveValue("CO");
    fireEvent.click(screen.getByRole("button", { name: /review conversion/i }));
    expect(screen.getByRole("heading", { name: /confirm conversion/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^confirm conversion$/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/website-inquiries/${inquiry.id}/convert`, expect.objectContaining({
      contact: { mode: "existing", id: matches.contacts[0].id },
      organization: { mode: "existing", id: matches.organizations[0].id },
      booking: expect.objectContaining({ name: "Summer Festival", city: "Denver", region: "CO" }),
    })));
    expect(await screen.findByRole("link", { name: /open new booking/i })).toBeInTheDocument();
  });

  it("supports manual search and keeps edited values after a server failure", async () => {
    const api = {
      get: vi.fn().mockResolvedValue([{ id: "10000000-0000-4000-8000-000000000009", label: "Dee Leigh", score: 0, reasons: ["Manual search"], context: { email: "dee@example.com" } }]),
      patch: vi.fn(),
      post: vi.fn().mockRejectedValue(new Error("Conversion unavailable")),
    } as WebsiteInquiryApi;
    render(<WebsiteInquiryConvertDialog api={api} inquiry={inquiry} matches={{ ...matches, contacts: [], organizations: [] }} onClose={vi.fn()} onConverted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/search contacts/i), { target: { value: "Dee" } });
    fireEvent.click(screen.getByRole("button", { name: /search contacts/i }));
    fireEvent.click(await screen.findByRole("button", { name: /use contact dee leigh/i }));
    fireEvent.click(screen.getByRole("button", { name: /create new profile/i }));
    fireEvent.change(screen.getByLabelText(/new profile name/i), { target: { value: "Edited Festival" } });
    fireEvent.change(screen.getByLabelText(/booking name/i), { target: { value: "Edited Booking" } });
    fireEvent.click(screen.getByRole("button", { name: /review conversion/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm conversion$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conversion unavailable");
    expect(screen.getByLabelText(/booking name/i)).toHaveValue("Edited Booking");
  });

  it("requires city and a two-letter state before confirmation", () => {
    const api = { get: vi.fn(), patch: vi.fn(), post: vi.fn() } as WebsiteInquiryApi;
    render(<WebsiteInquiryConvertDialog api={api} inquiry={{ ...inquiry, eventLocation: "Unknown" }} matches={{ contacts: [], organizations: [], parsedLocation: null }} onClose={vi.fn()} onConverted={vi.fn()} />);
    fireEvent.change(screen.getAllByLabelText(/state/i).at(-1)!, { target: { value: "Colorado" } });
    fireEvent.click(screen.getByRole("button", { name: /review conversion/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/city and two-letter state/i);
    expect(api.post).not.toHaveBeenCalled();
  });
});
