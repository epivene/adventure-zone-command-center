import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Rule, Selection } from "@/features/assistant-workspace/types";
const http = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/auth-token", () => ({ apiFetch: http.fetch }));
import { KnowledgePanel } from "./KnowledgePanel";
const customerId = "11111111-1111-4111-8111-111111111111";
const selection: Selection = {
  organizationIds: [customerId],
  eventYear: 2027,
  bookingId: null,
  threadId: null,
  draftId: null,
};
const rule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "rule-1",
  ruleKey: "Deposit terms",
  body: "40% deposit, balance on arrival.",
  sourceLabel: "Owner confirmed",
  organizationId: customerId,
  eventYear: 2027,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  reviewedAt: "2026-01-01",
  status: "approved",
  version: 2,
  headVersion: 4,
  ...overrides,
});
let rules: Rule[],
  approvalError: string | null,
  serial: number,
  proposalHead: number;
beforeEach(() => {
  rules = [];
  approvalError = null;
  serial = 0;
  proposalHead = 0;
  http.fetch.mockReset();
  http.fetch.mockImplementation(
    async (path: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : null;
      if (path.startsWith("/organizations/"))
        return Response.json({
          organization: {
            name: path.endsWith(customerId) ? "Kamiah BBQ Days" : "Burro Days",
          },
        });
      if (options.method === "GET") return Response.json(rules);
      if (path.endsWith("/knowledge")) {
        const proposal = rule({
          ...body,
          id: `proposal-${++serial}`,
          version: null,
          headVersion: proposalHead,
          status: "proposed",
          reviewedAt: null,
        });
        rules = [...rules, proposal];
        return Response.json(proposal);
      }
      if (path.endsWith("/approve")) {
        if (approvalError)
          return Response.json({ code: approvalError }, { status: 409 });
        const id = path.split("/").at(-2);
        const approved = {
          ...rules.find((item) => item.id === id)!,
          status: "approved",
          version: 5,
          headVersion: 5,
        };
        rules = rules.map((item) => (item.id === id ? approved : item));
        return Response.json(approved);
      }
      if (path.endsWith("/retire")) {
        const id = path.split("/").at(-2);
        const retired = {
          ...rules.find((item) => item.id === id)!,
          status: "superseded",
          headVersion: 5,
        };
        rules = rules.map((item) => (item.id === id ? retired : item));
        return Response.json(retired);
      }
      throw new Error(`Unexpected request ${path}`);
    },
  );
});
const writes = () =>
  http.fetch.mock.calls.filter(([, options]) => options.method === "POST");
async function addNote() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Add important info" }),
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Deposit terms" },
  });
  fireEvent.change(screen.getByLabelText("Important information"), {
    target: { value: "40% deposit, balance on arrival." },
  });
  fireEvent.change(screen.getByLabelText("Source or reason"), {
    target: { value: "Owner confirmed" },
  });
}
it("prefills a remembered message for review without automatically saving it", async () => {
  const onDirtyChange = vi.fn();
  render(
    <KnowledgePanel
      selection={selection}
      initialNote={{
        id: "message-1",
        text: "Confirmed deposit terms",
        sourceLabel: "Chat message",
      }}
      onDirtyChange={onDirtyChange}
    />,
  );
  expect(await screen.findByLabelText("Important information")).toHaveValue(
    "Confirmed deposit terms",
  );
  expect(screen.getByLabelText("Applies to")).toHaveValue(customerId);
  expect(screen.getByLabelText("Event year")).toHaveValue(2027);
  expect(
    screen.getByText(/chat history is saved automatically/i),
  ).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
});
it("requires an explicit customer scope and year choice when nothing is selected", async () => {
  render(<KnowledgePanel />);
  await addNote();
  expect(screen.getByLabelText("Applies to")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Save and remember" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Applies to"), {
    target: { value: "all" },
  });
  fireEvent.change(screen.getByLabelText("Year scope"), {
    target: { value: "all" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/saved and ready for the assistant/i);
  expect(JSON.parse(String(writes()[0][1].body))).toMatchObject({
    organizationId: null,
    eventYear: null,
  });
});
it("preserves a long message and asks the user to shorten it instead of truncating", async () => {
  const text = "x".repeat(12001);
  render(
    <KnowledgePanel
      selection={selection}
      initialNote={{ id: "long", text, sourceLabel: "Chat message" }}
    />,
  );
  expect(await screen.findByLabelText("Important information")).toHaveValue(
    text,
  );
  expect(screen.getByText(/shorten.*12,000/i)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save and remember" }),
  ).toBeDisabled();
});
it("saves a truly new scope using the reviewed initial version zero", async () => {
  render(<KnowledgePanel selection={selection} />);
  await addNote();
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/saved and ready for the assistant/i);
  expect(writes()).toHaveLength(2);
  expect(JSON.parse(String(writes()[0][1].body))).toMatchObject({
    ruleKey: "Deposit terms",
    organizationId: customerId,
    eventYear: 2027,
  });
  expect(JSON.parse(String(writes()[1][1].body))).toEqual({
    expectedVersion: 0,
  });
});
it("retries a failed approval without creating a duplicate proposal", async () => {
  approvalError = "SERVICE_UNAVAILABLE";
  render(<KnowledgePanel selection={selection} />);
  await addNote();
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/proposal is saved.*not yet remembered/i);
  expect(screen.getByLabelText("Important information")).toBeDisabled();
  approvalError = null;
  fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
  await screen.findByText(/saved and ready for the assistant/i);
  expect(writes().filter(([path]) => path.endsWith("/knowledge"))).toHaveLength(
    1,
  );
});
it("requires reloading and reviewing after a version conflict", async () => {
  approvalError = "ASSISTANT_RULE_VERSION_CONFLICT";
  render(<KnowledgePanel selection={selection} />);
  await addNote();
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/changed.*reload.*review/i);
  expect(
    screen.queryByRole("button", { name: "Retry saving" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reload and review" }));
  await screen.findByRole("button", { name: "Remember this proposal" });
  expect(writes()).toHaveLength(2);
});
it("offers editing an existing title in the same scope instead of creating a duplicate", async () => {
  rules = [rule()];
  render(<KnowledgePanel selection={selection} />);
  await addNote();
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "deposit TERMS" },
  });
  expect(screen.getByText(/already exists.*edit/i)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save and remember" }),
  ).toBeDisabled();
  expect(writes()).toHaveLength(0);
});
it("confirms stopping use and retains the item in history", async () => {
  rules = [rule()];
  render(<KnowledgePanel selection={selection} />);
  fireEvent.click(await screen.findByRole("button", { name: "Stop using" }));
  expect(writes()).toHaveLength(0);
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText(/history remain/i)).toBeInTheDocument();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Stop using this info" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
  expect(writes()[0][0]).toContain("/rule-1/retire");
  expect(JSON.parse(String(writes()[0][1].body))).toEqual({
    expectedVersion: 4,
  });
  fireEvent.click(screen.getByText("Saved info history"));
  expect(
    screen.getByText("40% deposit, balance on arrival."),
  ).toBeInTheDocument();
});
it("does not replace an unfinished form with another remembered message without confirmation", async () => {
  const { rerender } = render(
    <KnowledgePanel
      selection={selection}
      initialNote={{
        id: "first",
        text: "First message",
        sourceLabel: "Chat message",
      }}
    />,
  );
  await screen.findByLabelText("Important information");
  fireEvent.change(screen.getByLabelText("Important information"), {
    target: { value: "My edited note" },
  });
  rerender(
    <KnowledgePanel
      selection={selection}
      initialNote={{
        id: "second",
        text: "Second message",
        sourceLabel: "Chat message",
      }}
    />,
  );
  expect(screen.getByLabelText("Important information")).toHaveValue(
    "My edited note",
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Keep current form" }),
  );
  expect(screen.getByLabelText("Important information")).toHaveValue(
    "My edited note",
  );
  expect(writes()).toHaveLength(0);
});
it("requires a choice among multiple customers and does not expand one customer's note globally", async () => {
  render(
    <KnowledgePanel
      selection={{
        ...selection,
        organizationIds: [customerId, "22222222-2222-4222-8222-222222222222"],
      }}
    />,
  );
  await addNote();
  expect(screen.getByLabelText("Applies to")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Applies to"), {
    target: { value: customerId },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/saved and ready for the assistant/i);
  expect(JSON.parse(String(writes()[0][1].body))).toMatchObject({
    organizationId: customerId,
    eventYear: 2027,
  });
});
it("keeps a correction's reviewed version and scope even if proposing returns a newer head", async () => {
  rules = [rule()];
  const handler = http.fetch.getMockImplementation()!;
  http.fetch.mockImplementation(async (path, options) => {
    const response = await handler(path, options);
    if (path.endsWith("/knowledge") && options.method === "POST")
      return Response.json({ ...(await response.json()), headVersion: 8 });
    return response;
  });
  render(<KnowledgePanel selection={selection} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit saved info" }),
  );
  expect(screen.getByLabelText("Applies to")).toBeDisabled();
  expect(screen.getByLabelText("Effective from")).toHaveValue("2026-01-01");
  expect(screen.getByLabelText("Title")).toHaveAttribute("readonly");
  fireEvent.change(screen.getByLabelText("Important information"), {
    target: { value: "Updated owner instruction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/changed.*reload.*review/i);
  expect(writes()).toHaveLength(1);
  expect(JSON.parse(String(writes()[0][1].body))).toMatchObject({
    ruleKey: "Deposit terms",
    organizationId: customerId,
    eventYear: 2027,
  });
});
it("reconciles an unconfirmed proposal before allowing another create request", async () => {
  const handler = http.fetch.getMockImplementation()!;
  http.fetch.mockImplementation(async (path, options) => {
    const response = await handler(path, options);
    if (path.endsWith("/knowledge") && options.method === "POST")
      throw new TypeError("Network response lost");
    return response;
  });
  render(<KnowledgePanel selection={selection} />);
  await addNote();
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/save could not be confirmed/i);
  expect(
    screen.queryByRole("button", { name: "Save and remember" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reload and review" }));
  const approve = await screen.findByRole("button", {
    name: "Remember this proposal",
  });
  fireEvent.click(approve);
  await screen.findByText(/saved and ready for the assistant/i);
  expect(writes().filter(([path]) => path.endsWith("/knowledge"))).toHaveLength(
    1,
  );
});
it("can replace an unfinished form only after the user chooses to replace it", async () => {
  const onDirtyChange = vi.fn();
  const { rerender } = render(
    <KnowledgePanel
      selection={selection}
      initialNote={{
        id: "first",
        text: "First message",
        sourceLabel: "Chat message",
      }}
      onDirtyChange={onDirtyChange}
    />,
  );
  await screen.findByLabelText("Important information");
  rerender(
    <KnowledgePanel
      selection={selection}
      initialNote={{
        id: "second",
        text: "Second message",
        sourceLabel: "Other message",
      }}
      onDirtyChange={onDirtyChange}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Replace with new message" }),
  );
  expect(screen.getByLabelText("Important information")).toHaveValue(
    "Second message",
  );
  expect(screen.getByLabelText("Source or reason")).toHaveValue(
    "Other message",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(writes()).toHaveLength(0);
});
it("requires review when another tab creates the same new scope after the reviewed list loaded", async () => {
  render(<KnowledgePanel selection={selection} />);
  await addNote();
  proposalHead = 1;
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/changed.*reload.*review/i);
  expect(writes()).toHaveLength(1);
  expect(writes().some(([path]) => path.endsWith("/approve"))).toBe(false);
});
it("re-adds retired info using its reviewed scope head rather than zero or its old approved version", async () => {
  rules = [rule({ status: "superseded", version: 2, headVersion: 4 })];
  proposalHead = 4;
  render(<KnowledgePanel selection={selection} />);
  await addNote();
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "deposit terms" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save and remember" }));
  await screen.findByText(/saved and ready for the assistant/i);
  expect(JSON.parse(String(writes()[0][1].body))).toMatchObject({
    ruleKey: "Deposit terms",
  });
  expect(JSON.parse(String(writes()[1][1].body))).toEqual({
    expectedVersion: 4,
  });
});
it("identifies multiple customer choices by their fetched names and links", async () => {
  const other = "22222222-2222-4222-8222-222222222222";
  render(
    <KnowledgePanel
      selection={{ ...selection, organizationIds: [customerId, other] }}
    />,
  );
  await addNote();
  expect(
    await screen.findByRole("option", { name: "Kamiah BBQ Days" }),
  ).toHaveValue(customerId);
  expect(await screen.findByRole("option", { name: "Burro Days" })).toHaveValue(
    other,
  );
  expect(
    screen.getByRole("link", { name: "Open Kamiah BBQ Days profile" }),
  ).toHaveAttribute("href", `/profiles/${customerId}`);
  expect(
    screen.getByRole("link", { name: "Open Burro Days profile" }),
  ).toHaveAttribute("href", `/profiles/${other}`);
});
it("identifies saved info outside the current selection in its review and retirement confirmation", async () => {
  rules = [rule()];
  render(<KnowledgePanel />);
  const customer = await screen.findByRole("link", {
    name: "Open Kamiah BBQ Days profile",
  });
  expect(customer).toHaveAttribute("href", `/profiles/${customerId}`);
  fireEvent.click(screen.getByRole("button", { name: "Stop using" }));
  const dialog = screen.getByRole("alertdialog");
  expect(
    within(dialog).getByRole("link", { name: "Open Kamiah BBQ Days profile" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText(/removed from active saved info/i),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText(/previous chats.*history.*remain/i),
  ).toBeInTheDocument();
});
it("keeps a specific customer profile link available when its name cannot be loaded", async () => {
  rules = [rule()];
  const handler = http.fetch.getMockImplementation()!;
  http.fetch.mockImplementation((path, options) =>
    path.startsWith("/organizations/")
      ? Promise.resolve(Response.json({}, { status: 503 }))
      : handler(path, options),
  );
  render(<KnowledgePanel />);
  const link = await screen.findByRole("link", {
    name: "Open Customer profile (11111111)",
  });
  expect(link).toHaveAttribute("href", `/profiles/${customerId}`);
  expect(link).toHaveTextContent("Customer profile (11111111)");
  expect(screen.queryByText(customerId)).not.toBeInTheDocument();
});
it("cancels outstanding customer-name reads when the panel is unmounted", async () => {
  const handler = http.fetch.getMockImplementation()!;
  http.fetch.mockImplementation((path, options) =>
    path.startsWith("/organizations/")
      ? new Promise(() => {})
      : handler(path, options),
  );
  const { unmount } = render(<KnowledgePanel selection={selection} />);
  await waitFor(() =>
    expect(
      http.fetch.mock.calls.some(([path]) =>
        path.startsWith("/organizations/"),
      ),
    ).toBe(true),
  );
  const signal = http.fetch.mock.calls.find(([path]) =>
    path.startsWith("/organizations/"),
  )![1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
});
it("allows cancelling an unsaved remembered-message form after initial loading and reloading both fail", async () => {
  const onDirtyChange = vi.fn();
  http.fetch.mockResolvedValue(
    Response.json({ code: "UNAVAILABLE" }, { status: 503 }),
  );
  render(
    <KnowledgePanel
      selection={selection}
      initialNote={{
        id: "failed",
        text: "Keep this",
        sourceLabel: "Chat message",
      }}
      onDirtyChange={onDirtyChange}
    />,
  );
  await screen.findByText(/saved info could not be loaded/i);
  fireEvent.click(screen.getByRole("button", { name: "Reload and review" }));
  await screen.findByText(/saved info could not be reloaded/i);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    screen.queryByLabelText("Important information"),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(
    screen.getByRole("button", { name: "Reload and review" }),
  ).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});
it("allows closing a conflicted saved proposal without dropping its history or retrying a write", async () => {
  rules = [rule({ status: "proposed", version: null })];
  approvalError = "ASSISTANT_RULE_VERSION_CONFLICT";
  const onDirtyChange = vi.fn();
  render(<KnowledgePanel onDirtyChange={onDirtyChange} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Remember this proposal" }),
  );
  await screen.findByText(/changed.*reload.*review/i);
  fireEvent.click(screen.getByRole("button", { name: "Close review" }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(
    screen.getByText("40% deposit, balance on arrival."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Reload and review" }),
  ).toBeInTheDocument();
  expect(writes()).toHaveLength(1);
});
