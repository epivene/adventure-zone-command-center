// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiGet, apiPatch, apiPost, apiPut } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPatch, apiPost, apiPut }));

import { ProfileInlineEditor } from "./profile-inline-editor";

const profileWithoutContacts = {
  id: "madison-county-fair",
  place: {
    name: "Madison County Fair",
    description: null,
    phone: null,
    website: null,
    address1: "2 Fairgrounds Loop, Twin Bridges MT",
    address2: null,
    city: "Twin Bridges",
    region: "MT",
    postalCode: null,
  },
  contacts: [],
};

describe("ProfileInlineEditor profile-only saves", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiPatch.mockResolvedValue({ ok: true });
    apiPost.mockResolvedValue({ ok: true, contactId: "unexpected-contact" });
    apiPut.mockResolvedValue({ ok: true });
  });

  afterEach(cleanup);

  it("does not create a blank contact when a profile with no contacts is edited", async () => {
    const onSaved = vi.fn();
    render(<ProfileInlineEditor profile={profileWithoutContacts as any} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("Event description"), { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith(
      "/event-profiles/madison-county-fair/description",
      { description: "Test" },
    ));
    expect(apiPost).not.toHaveBeenCalled();
    expect(apiPut).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });
});
