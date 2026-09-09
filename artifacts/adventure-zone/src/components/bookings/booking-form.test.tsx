// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  geocode: vi.fn(),
  navigate: vi.fn(),
  loadDraft: vi.fn(() => null),
  saveDraft: vi.fn(() => ({ ok: true })),
  deleteDraft: vi.fn(() => ({ ok: true })),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["", mocks.navigate],
}));

vi.mock("@/actions/trips", () => ({
  geocodeAddressAction: mocks.geocode,
}));

vi.mock("@/lib/offline/draft-store", () => ({
  loadDraft: mocks.loadDraft,
  saveDraft: mocks.saveDraft,
  deleteDraft: mocks.deleteDraft,
}));

import { BookingForm } from "./booking-form";

const initialValues = {
  name: "Mapped Event",
  venueName: "City Park",
  address1: "100 Main St",
  city: "Boise",
  region: "ID",
  postalCode: "83702",
  latitude: "",
  longitude: "",
  startsAt: "2026-06-01",
  endsAt: "2026-06-02",
  status: "possible" as const,
  probability: "possible" as const,
  travelLegId: "",
  notes: "",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BookingForm location safeguards", () => {
  it("looks up the complete event address instead of only city and state", async () => {
    mocks.geocode.mockResolvedValue({ ok: true, results: [] });
    render(
      <BookingForm
        variant="edit"
        initialValues={initialValues}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Find coordinates" }));

    await waitFor(() =>
      expect(mocks.geocode).toHaveBeenCalledWith(
        "City Park, 100 Main St, Boise, ID, 83702",
      ),
    );
  });

  it("clears stale coordinates when the event location changes", () => {
    render(
      <BookingForm
        variant="edit"
        initialValues={{
          ...initialValues,
          latitude: "43.615",
          longitude: "-116.202",
        }}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Street address" }), {
      target: { value: "200 Main St" },
    });

    expect(screen.getByRole("textbox", { name: "Latitude" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Longitude" })).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Location changed — choose coordinates again",
    );
  });

  it("warns when the selected result does not match the booking city and state", async () => {
    mocks.geocode.mockResolvedValue({
      ok: true,
      results: [
        {
          displayName: "100 Main St, Springfield, Illinois",
          latitude: 39.8,
          longitude: -89.65,
        },
      ],
    });
    render(
      <BookingForm
        variant="edit"
        initialValues={initialValues}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Find coordinates" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /100 Main St, Springfield, Illinois/,
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "does not appear to match Boise, ID",
    );
    expect(screen.getByText(/Mapped to 100 Main St, Springfield/)).toBeInTheDocument();
  });

  it("starts a location lookup instead of submitting an unmapped confirmed event", async () => {
    mocks.geocode.mockResolvedValue({ ok: true, results: [] });
    const onSubmit = vi.fn();
    render(
      <BookingForm
        variant="edit"
        initialValues={{ ...initialValues, status: "confirmed" }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.geocode).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Map this confirmed event before saving",
    );
  });
});
