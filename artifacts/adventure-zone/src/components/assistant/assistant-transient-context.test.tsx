import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantContextProvider, useAssistantContext } from "@/features/assistant/assistant-context";
import { AssistantTransientContext } from "./assistant-transient-context";

function Probe() {
  const { activeContext, setPageContext, selectExplicitContext } = useAssistantContext();
  return (
    <div>
      <button onClick={() => setPageContext({ kind: "organization", recordId: "page", label: "Page" })}>page</button>
      <button onClick={() => selectExplicitContext({ kind: "organization", recordId: "explicit", label: "Explicit" })}>explicit</button>
      <span data-testid="active">{activeContext?.recordId ?? "general"}</span>
    </div>
  );
}

function tree(open: boolean) {
  return (
    <AssistantContextProvider>
      <Probe />
      <AssistantTransientContext open={open} kind="organization" recordId="side" label="Side" />
    </AssistantContextProvider>
  );
}

describe("AssistantTransientContext", () => {
  it("temporarily overrides page context and restores it on close", () => {
    const { rerender } = render(tree(false));
    fireEvent.click(screen.getByRole("button", { name: "page" }));
    expect(screen.getByTestId("active").textContent).toBe("page");

    rerender(tree(true));
    expect(screen.getByTestId("active").textContent).toBe("side");

    rerender(tree(false));
    expect(screen.getByTestId("active").textContent).toBe("page");
  });

  it("restores an explicit search-selected context after the side profile closes", () => {
    const { rerender } = render(tree(false));
    fireEvent.click(screen.getByRole("button", { name: "page" }));
    fireEvent.click(screen.getByRole("button", { name: "explicit" }));
    expect(screen.getByTestId("active").textContent).toBe("explicit");

    rerender(tree(true));
    expect(screen.getByTestId("active").textContent).toBe("side");

    rerender(tree(false));
    expect(screen.getByTestId("active").textContent).toBe("explicit");
  });
});
