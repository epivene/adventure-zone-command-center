// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiGet, apiPatch, apiPost, apiPut } = vi.hoisted(() => ({
  apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPatch, apiPost, apiPut }));

import { ProfileInlineEditor } from "./profile-inline-editor";

describe("ProfileInlineEditor primary contact", () => {
  beforeEach(() => {
    apiGet.mockResolvedValue({
      contact: { firstName: "Rebecca", lastName: "Van Pelt", organizationName: "Phillips County Fair", jobTitle: "Fair Manager", email: "info@phillipscountyfair.org", phone: "970-520-5052", address1: "", address2: "", city: "Holyoke", region: "CO", postalCode: "80734" },
      phones: [{ id: "phone-1", number: "970-520-5052", primary: true }],
    });
    apiPatch.mockResolvedValue({ ok: true });
    apiPut.mockResolvedValue({ ok: true });
  });
  afterEach(cleanup);

  it("can change the profile primary contact without rewriting protected phone records", async () => {
    const onSaved = vi.fn();
    render(<ProfileInlineEditor profile={{
      id: "profile-1",
      place: { name: "Phillips County Fair" },
      contacts: [
        { id: "kayla", name: "Kayla Kafka", isPrimary: true },
        { id: "rebecca", name: "Rebecca Van Pelt", isPrimary: false },
      ],
    } as any} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("Contact to edit"), { target: { value: "rebecca" } });
    fireEvent.click(await screen.findByRole("button", { name: "Make primary contact" }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      "/event-profiles/profile-1/primary-contact",
      { contactId: "rebecca" },
    ));
    expect(apiPut).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalled();
  });
});
