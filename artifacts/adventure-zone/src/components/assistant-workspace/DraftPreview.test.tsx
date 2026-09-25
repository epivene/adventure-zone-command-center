import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Draft } from "@/features/assistant-workspace/types";
import { DraftPreview } from "./DraftPreview";
const draft: Draft = {
  id: "draft",
  revision: "one",
  status: "saved",
  gmailDraftId: "gmail-one",
  content: {
    to: ["janet@example.test"],
    cc: [],
    subject: "Deposit check",
    html: '<table><tbody><tr><td style="background-color:#ffffff"><p>Hello Janet</p><p>Has the check been sent?</p></td></tr></tbody></table>',
    text: "Hello Janet\nHas the check been sent?",
    threadId: null,
    attachmentIds: [],
    templateId: null,
    templateVersion: "1",
  },
};
function setup(onEdit = vi.fn().mockResolvedValue(undefined)) {
  const props = {
    draft,
    busy: false,
    onEdit,
    onSave: vi.fn(),
    onRevise: vi.fn(),
    onReviewSend: vi.fn(),
  };
  return { ...render(<DraftPreview {...props} />), props };
}
it("opens the preview for direct edits and saves subject/body with the original revision", async () => {
  const { props } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Edit email preview" }));
  expect(screen.getByRole("button", { name: "Save in Gmail" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Review before sending" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Email subject"), {
    target: { value: "Quick check" },
  });
  const greeting = screen.getByText("Hello Janet");
  greeting.textContent = "Hi Janet!";
  fireEvent.input(greeting);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(props.onEdit).toHaveBeenCalledTimes(1));
  const [original, patch] = props.onEdit.mock.calls[0];
  expect(original.revision).toBe("one");
  expect(patch.subject).toBe("Quick check");
  expect(patch.html).toContain("Hi Janet!");
  expect(patch.html).toContain("<table>");
  expect(patch.text).toContain("Hi Janet!");
  expect(props.onSave).not.toHaveBeenCalled();
  expect(props.onReviewSend).not.toHaveBeenCalled();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Changes saved in the app",
  );
});
it("keeps unsaved edits through refreshes and refuses to overwrite a newer revision", () => {
  const { rerender, props } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Edit email preview" }));
  fireEvent.change(screen.getByLabelText("Email subject"), {
    target: { value: "My edit" },
  });
  rerender(
    <DraftPreview
      {...props}
      draft={{
        ...draft,
        revision: "two",
        content: { ...draft.content, subject: "Changed elsewhere" },
      }}
    />,
  );
  expect(screen.getByLabelText("Email subject")).toHaveValue("My edit");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your edits are still here",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel edits" }));
  expect(screen.getByTitle("Preview: Changed elsewhere")).toBeTruthy();
  expect(props.onEdit).not.toHaveBeenCalled();
});
it("keeps failed edits available for retry and makes cancel a local action", async () => {
  const { props } = setup(vi.fn().mockRejectedValue(new Error("network")));
  fireEvent.click(screen.getByRole("button", { name: "Edit email preview" }));
  fireEvent.change(screen.getByLabelText("Email subject"), {
    target: { value: "Keep me" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your edits are still here",
  );
  expect(screen.getByLabelText("Email subject")).toHaveValue("Keep me");
  fireEvent.click(screen.getByRole("button", { name: "Cancel edits" }));
  expect(screen.getByTitle("Preview: Deposit check")).toBeTruthy();
  expect(props.onSave).not.toHaveBeenCalled();
});
it.each(["sent", "uncertain", "saving", "sending"])(
  "locks editing while a draft is %s",
  (status) => {
    const { rerender, props } = setup();
    rerender(<DraftPreview {...props} draft={{ ...draft, status }} />);
    expect(
      screen.queryByRole("button", { name: "Edit email preview" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save in Gmail" }),
    ).toBeDisabled();
  },
);
