import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/contacts/contact-1/edit", navigate],
}));

import { ContactForm } from "./contact-form";

const initialValues = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "701-555-0199",
};

describe("ContactForm phone submission", () => {
  afterEach(cleanup);
  it("keeps only the legacy phone field editable without a phone persistence callback", () => {
    render(
      <ContactForm
        initialValues={initialValues}
        onSubmit={() => ({ ok: true })}
        successPath="/contacts/contact-1"
      />,
    );

    expect(screen.getByLabelText("Primary phone")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add phone" })).not.toBeInTheDocument();
  });

  it("submits the edited legacy primary number in the phone replacement payload", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const onPhonesSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <ContactForm
        initialValues={initialValues}
        initialPhones={[{
          id: "11111111-1111-4111-8111-111111111111",
          number: "701-555-0199",
          type: "mobile",
          extension: null,
          label: null,
          primary: true,
        }]}
        onSubmit={onSubmit}
        onPhonesSubmit={onPhonesSubmit}
        successPath="/contacts/contact-1"
        variant="edit"
      />,
    );

    fireEvent.change(screen.getByLabelText("Primary phone"), {
      target: { value: "701-555-0100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));

    await waitFor(() => {
      expect(onPhonesSubmit).toHaveBeenCalledWith([
        expect.objectContaining({ number: "701-555-0100", primary: true }),
      ]);
    });
  });

  it("submits contact fields and phones in one atomic callback", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <ContactForm
        initialValues={initialValues}
        initialPhones={[{
          id: "11111111-1111-4111-8111-111111111111", number: "701-555-0199",
          type: "mobile", extension: null, label: null, primary: true,
        }]}
        onSubmit={onSubmit}
        phonesEditable
        successPath="/contacts/contact-1"
        variant="edit"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Ada" }),
      [expect.objectContaining({ number: "701-555-0199", extension: null, label: null })],
    ));
  });

  it("submits any manual value entered in the email field", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <ContactForm
        initialValues={initialValues}
        onSubmit={onSubmit}
        successPath="/contacts/contact-1"
      />,
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "Use the website contact form" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ email: "use the website contact form" }),
      undefined,
    ));
  });

  it("prevents editing or removing a suppressed phone row", () => {
    render(
      <ContactForm
        initialValues={initialValues}
        initialPhones={[{
          id: "11111111-1111-4111-8111-111111111111", number: "701-555-0199",
          type: "mobile", extension: null, label: null, primary: true,
          doNotCallAt: "2026-08-13T16:00:00.000Z", doNotCallReason: "Requested",
        }]}
        onSubmit={() => ({ ok: true })}
        phonesEditable
        successPath="/contacts/contact-1"
      />,
    );

    expect(screen.getByLabelText("Phone number")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Do Not Call — protected" })).toBeDisabled();
  });
});
