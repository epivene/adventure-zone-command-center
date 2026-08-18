import { render, screen } from "@testing-library/react";
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

describe("AssistantTransientContext", () => {
  it("temporarily overrides page context and restores it on close", () => {
    const { rerender } = render(
      <AssistantContextProvider>
        <Probe />
        <AssistantTransientContext open={false} kind="organization" recordId="side" label="Side" />
      </AssistantContextProvider>,
    );
    screen.getByRole("button", { name: "page" }).click();
    expect(screen.getByTestId("active").textContent).toBe("page");

    rerender(
      <AssistantContextProvider>
        <Probe />
        <AssistantTransientContext open kind="organization" recordId="side" label="Side" />
      </AssistantContextProvider>,
    );
    expect(screen.getByTestId("active").textContent).toBe("side");
  });
});
