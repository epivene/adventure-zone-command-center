// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerPreviewMap } from "./manager-preview-map";

vi.mock("@/lib/auth-token", () => ({
  apiGet: vi.fn(async () => ({
    leg: { id: "leg-k", name: "Kristy", color: "#f97316" },
    route: null,
    events: [{ bookingId: "b1", bookingName: "Kristy Fair", city: "Dickinson", region: "ND", latitude: 46.8, longitude: -102.8, startsAt: null, endsAt: null, status: "confirmed" }],
    meetups: [],
  })),
}));
vi.mock("@/components/manager/manager-scoped-map", () => ({
  ManagerScopedMap: ({ data, readOnlyPreview }: any) => <div aria-label="Manager preview map">{data.leg.name} · {readOnlyPreview ? "read only" : "editable"}</div>,
}));

afterEach(cleanup);

describe("ManagerPreviewMap", () => {
  it("renders the selected manager using the shared private map contract in read-only mode", async () => {
    render(<ManagerPreviewMap legId="00000000-0000-4000-8000-000000000001" />);
    expect(await screen.findByLabelText("Manager preview map")).toHaveTextContent("Kristy");
    expect(screen.getByLabelText("Manager preview map")).toHaveTextContent("read only");
    expect(screen.getByText(/Read-only preview/)).toBeInTheDocument();
    expect(screen.queryByText("Suggest change")).not.toBeInTheDocument();
    expect(screen.queryByText("Update local fuel price")).not.toBeInTheDocument();
  });
});
