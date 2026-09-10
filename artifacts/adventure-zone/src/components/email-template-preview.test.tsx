// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailTemplatePreview } from "./email-template-preview";

let width = 304;
let resize: () => void;
const disconnect = vi.fn();

beforeEach(() => {
  width = 304;
  disconnect.mockClear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("email preview fitting", () => {
  it("fits the full email to a phone and updates when its container changes", () => {
    const { unmount } = render(<EmailTemplatePreview title="Review" html="<p>Email</p>" />);
    const frame = screen.getByTitle("Review") as HTMLIFrameElement;
    expect(frame.style.width).toBe("700px");
    expect(frame.style.transform).toBe("scale(0.4342857142857143)");
    expect(frame.parentElement?.style.width).toBe("304px");
    expect(frame.style.height).toBe("230.26315789473685%");
    act(() => { width = 570; resize(); });
    expect(frame.style.transform).toBe("scale(0.8142857142857143)");
    act(() => { width = 1200; resize(); });
    expect(frame.style.transform).toBe("scale(1)");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("lets the reviewer switch to full size and back without reloading the email", () => {
    render(<EmailTemplatePreview title="Review" html="<p>Email</p>" />);
    const frame = screen.getByTitle("Review") as HTMLIFrameElement;
    const document = frame.srcdoc;
    fireEvent.click(screen.getByRole("button", { name: "Full size" }));
    expect(frame.style.transform).toBe("scale(1)");
    expect(frame.parentElement?.style.width).toBe("700px");
    expect(screen.getByText("Swipe sideways to see the rest.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(frame.style.transform).toBe("scale(0.4342857142857143)");
    expect(frame.srcdoc).toBe(document);
  });

  it("preserves link testing and the sandbox while scaling only the preview", () => {
    const html = '<table width="640"><tr><td><a href="https://example.com/watch">Video</a></td></tr></table><script>alert(1)</script>';
    render(<EmailTemplatePreview title="Review" html={html} />);
    const frame = screen.getByTitle("Review") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    const doc = new DOMParser().parseFromString(frame.srcdoc, "text/html");
    expect(doc.querySelector("a")?.target).toBe("_blank");
    expect(doc.querySelector("table")?.getAttribute("width")).toBe("640");
    expect(doc.querySelector("script")).toBeNull();
    expect(html).toContain('<table width="640">');
  });
});
