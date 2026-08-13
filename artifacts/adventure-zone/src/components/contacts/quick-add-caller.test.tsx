import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/quick-add", navigate],
}));

import { QuickAddCaller } from "./quick-add-caller";

const existingId = "11111111-1111-4111-8111-111111111111";
const requestKey = "99999999-9999-4999-8999-999999999999";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Avery Lee" } });
  fireEvent.change(screen.getByLabelText("Organization or event"), { target: { value: "Prairie Days" } });
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "701-555-0199" } });
  fireEvent.change(screen.getByLabelText("Reason for calling"), { target: { value: "New event inquiry" } });
}

afterEach(() => {
  cleanup();
  navigate.mockReset();
  vi.unstubAllGlobals();
});

describe("QuickAddCaller duplicate confirmation", () => {
  it("never offers a create bypass for an exact phone or email conflict", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestKey });
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      canContinueCreating: false,
      candidates: [{
        contactId: existingId,
        name: "Avery Lee",
        organizationName: "Prairie Days",
        city: "Minot",
        region: "ND",
        reasons: ["Exact phone"],
        kind: "exact",
      }],
    });
    render(<QuickAddCaller onSubmit={onSubmit} />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Create caller" }));

    expect(await screen.findByText("Possible duplicate")) .toBeVisible();
    expect(screen.getByRole("link", { name: "Open profile" })).toHaveAttribute(
      "href",
      `/contacts/${existingId}`,
    );
    expect(screen.queryByRole("button", { name: "Create separate contact" }))
      .not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit click before creating past likely candidates with the same request key", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestKey });
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        canContinueCreating: true,
        candidates: [{
          contactId: existingId,
          name: "Avery Lee",
          organizationName: "Prairie Days",
          city: "Minot",
          region: "ND",
          reasons: ["Name and organization"],
          kind: "likely",
        }],
      })
      .mockResolvedValueOnce({ ok: true, contactId: "new-contact-id" });
    render(<QuickAddCaller onSubmit={onSubmit} />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Create caller" }));
    const continueButton = await screen.findByRole("button", {
      name: "Create separate contact",
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(continueButton);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      requestKey,
      continueCreating: false,
    });
    expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({
      requestKey,
      continueCreating: true,
    });
    expect(navigate).toHaveBeenCalledWith("/calls/new?contactId=new-contact-id");
  });

  it("does not offer a bypass when the server reports an unlisted exact conflict", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestKey });
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      candidates: [],
      canContinueCreating: false,
    });
    render(<QuickAddCaller onSubmit={onSubmit} />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create caller" }));

    expect(await screen.findByText(/exact phone or email conflict/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create separate contact" }))
      .not.toBeInTheDocument();
  });

  it("shows the actionable validation message returned by the API", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestKey });
    const onSubmit = vi.fn().mockRejectedValue(
      new Error("Enter the caller's name."),
    );
    render(<QuickAddCaller onSubmit={onSubmit} />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Create caller" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the caller's name.",
    );
  });

  it("does not offer continuation when an exact conflict is hidden beyond bounded likely candidates", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => requestKey });
    const onSubmit = vi.fn().mockResolvedValue({
      ok: false,
      canContinueCreating: false,
      candidates: Array.from({ length: 8 }, (_, index) => ({
        contactId: `likely-${index}`,
        name: `Avery Lee ${index}`,
        organizationName: "Prairie Days",
        city: "Minot",
        region: "ND",
        reasons: ["Name and organization"],
        kind: "likely",
      })),
    });
    render(<QuickAddCaller onSubmit={onSubmit} />);
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "Create caller" }));

    expect(await screen.findByText("Avery Lee 7")).toBeVisible();
    expect(screen.getByText(/exact phone or email conflict/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create separate contact" }))
      .not.toBeInTheDocument();
  });
});
