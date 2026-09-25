import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantMessage } from "./AssistantMessage";

describe("AssistantMessage", () => {
  it("renders assistant emphasis, quoted drafts and lists as readable content", () => {
    const { container } = render(
      <AssistantMessage
        text={
          "I found **Caldwell** with **no active contacts**.\n\n- `activeContactCount: 0`\n- History has not been checked.\n\n> Hi Janet,\n> Have you sent the check?"
        }
      />,
    );
    expect(screen.getByText("Caldwell").tagName).toBe("STRONG");
    expect(screen.getByText("activeContactCount: 0").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("blockquote")?.textContent).toContain(
      "Have you sent the check?",
    );
    expect(container.textContent).not.toContain("**");
  });

  it("keeps untrusted HTML, unsafe URLs and remote images inert", () => {
    const { container } = render(
      <AssistantMessage
        text={
          '<script>alert(1)</script>\n\n<img src="https://tracking.test/pixel" onerror="alert(1)">\n\n[Unsafe](javascript:alert%281%29)\n\n![Tracking image](https://tracking.test/pixel)\n\n[Customer profile](/profiles/example)\n\n[Website](https://example.test)'
        }
      />,
    );
    expect(
      container.querySelector("script,img,iframe,style,[onerror]"),
    ).toBeNull();
    expect(screen.getByText("Unsafe").closest("a")).toBeNull();
    expect(screen.getByText("Tracking image").tagName).toBe("SPAN");
    expect(
      screen
        .getByRole("link", { name: "Customer profile" })
        .getAttribute("href"),
    ).toBe("/profiles/example");
    const external = screen.getByRole("link", { name: "Website" });
    expect(external.getAttribute("rel")).toContain("noreferrer");
    expect(external.getAttribute("target")).toBe("_blank");
  });
});
