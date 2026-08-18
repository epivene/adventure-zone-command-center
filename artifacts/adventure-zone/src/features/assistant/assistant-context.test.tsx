import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AssistantContextProvider, useAssistantContext } from "./assistant-context";
import type { ActiveAssistantContext } from "./assistant-types";

function wrapper({ children }: { children: ReactNode }) {
  return <AssistantContextProvider>{children}</AssistantContextProvider>;
}

const profileA: Exclude<ActiveAssistantContext, null> = {
  kind: "organization",
  recordId: "00000000-0000-4000-8000-000000000001",
  label: "Profile A",
};
const profileB: Exclude<ActiveAssistantContext, null> = {
  kind: "organization",
  recordId: "00000000-0000-4000-8000-000000000002",
  label: "Profile B",
};
const profileC: Exclude<ActiveAssistantContext, null> = {
  kind: "contact",
  recordId: "00000000-0000-4000-8000-000000000003",
  label: "Side profile",
};

describe("AssistantContextProvider", () => {
  it("treats no concrete context as valid general mode", () => {
    const { result } = renderHook(() => useAssistantContext(), { wrapper });
    expect(result.current.activeContext).toBeNull();
  });

  it("prioritizes transient then explicit then page context and restores underneath state", () => {
    const { result } = renderHook(() => useAssistantContext(), { wrapper });

    act(() => result.current.setPageContext(profileA));
    expect(result.current.activeContext).toEqual(profileA);

    act(() => result.current.selectExplicitContext(profileB));
    expect(result.current.activeContext).toEqual(profileB);

    act(() => result.current.setTransientContext(profileC));
    expect(result.current.activeContext).toEqual(profileC);

    act(() => result.current.clearTransientContext());
    expect(result.current.activeContext).toEqual(profileB);

    act(() => result.current.clearExplicitContext());
    expect(result.current.activeContext).toEqual(profileA);
  });

  it("clears a stale explicit selection when a different canonical page context takes over", () => {
    const { result } = renderHook(() => useAssistantContext(), { wrapper });

    act(() => result.current.setPageContext(profileA));
    act(() => result.current.selectExplicitContext(profileB));
    expect(result.current.activeContext).toEqual(profileB);

    act(() => result.current.setPageContext(profileC));
    expect(result.current.explicitContext).toBeNull();
    expect(result.current.activeContext).toEqual(profileC);
  });
});
