import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EditableEmailBody,
  type EditableEmailBodyHandle,
} from "./EditableEmailBody";

const branded =
  '<!doctype html><html><head><style>@media(max-width:600px){table{width:100%}}</style></head><body style="background:#eee"><table class="brand" width="600"><tbody><tr><td style="background-color:#fff;padding:20px"><h2>The Adventure Zone</h2><p>Hi Janet,</p><p>Did you send the deposit check?</p><p>Thanks!<br>Desiree</p><a href="https://example.test" target="_blank">Our website</a></td></tr><tr><td style="background-color:#191927;color:#fff">Fully insured</td></tr></tbody></table></body></html>';

function edit(element: HTMLElement, value: string) {
  element.textContent = value;
  fireEvent.input(element);
}

describe("EditableEmailBody", () => {
  it("edits rendered text while preserving the email document, branding and links", () => {
    const ref = createRef<EditableEmailBodyHandle>();
    const dirty = vi.fn();
    render(<EditableEmailBody ref={ref} html={branded} onDirty={dirty} />);
    expect(ref.current!.getValue().html).toBe(branded);
    edit(
      screen.getByText("Did you send the deposit check?"),
      "Have you mailed the check yet?\nThanks for checking.",
    );
    const value = ref.current!.getValue();
    expect(value.html).toContain(
      "Have you mailed the check yet?<br>Thanks for checking.",
    );
    expect(value.html).toContain(
      '<a href="https://example.test" target="_blank">Our website</a>',
    );
    expect(value.html).toContain('<body style="background:#eee">');
    expect(value.html).toContain(
      "<style>@media(max-width:600px){table{width:100%}}</style>",
    );
    expect(value.html).toContain('class="brand" width="600"');
    expect(value.html).toContain("background-color:#191927;color:#fff");
    expect(value.text).toContain(
      "Have you mailed the check yet?\nThanks for checking.",
    );
    expect(value.text).toContain("The Adventure Zone");
    expect(value.text).toContain("Thanks!\nDesiree");
    expect(value.text).not.toContain("Did you send");
    expect(value.text).not.toContain("@media");
    expect(dirty).toHaveBeenLastCalledWith(true);
  });

  it("keeps unsaved text through incoming refreshes, and recognizes restored text", () => {
    const ref = createRef<EditableEmailBodyHandle>();
    const dirty = vi.fn();
    const view = render(
      <EditableEmailBody ref={ref} html="<p>Original</p>" onDirty={dirty} />,
    );
    const field = screen.getByRole("textbox");
    edit(field, "My local edit");
    view.rerender(
      <EditableEmailBody
        ref={ref}
        html="<p>Changed on server</p>"
        onDirty={dirty}
      />,
    );
    expect(field.textContent).toBe("My local edit");
    expect(ref.current!.getValue()).toEqual({
      html: "<p>My local edit</p>",
      text: "My local edit",
    });
    edit(field, "Original");
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(ref.current!.getValue().html).toBe("<p>Original</p>");
  });

  it("pastes only literal plain text at the selection and retains the caret", () => {
    const ref = createRef<EditableEmailBodyHandle>();
    render(<EditableEmailBody ref={ref} html="<p>Hello Janet</p>" />);
    const field = screen.getByRole("textbox");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(field.firstChild!, 6);
    range.setEnd(field.firstChild!, 11);
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboardData = {
      getData: vi.fn((type: string) =>
        type === "text/plain"
          ? "<script>alert(1)</script>\nfriend"
          : '<img src="https://tracking.test/">',
      ),
    };
    fireEvent.paste(field, { clipboardData });
    expect(clipboardData.getData).toHaveBeenCalledExactlyOnceWith("text/plain");
    expect(field.querySelector("script,img")).toBeNull();
    expect(ref.current!.getValue()).toEqual({
      html: "<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;<br>friend</p>",
      text: "Hello <script>alert(1)</script>\nfriend",
    });
    expect(selection.isCollapsed).toBe(true);
    expect(field.contains(selection.anchorNode)).toBe(true);
  });

  it("never mounts source scripts, resources, styles, handlers or live links", () => {
    const ref = createRef<EditableEmailBodyHandle>();
    const malicious =
      '<style>body{display:none}</style><script>window.unsafe = true</script><iframe src="https://tracking.test/frame"></iframe><link rel="stylesheet" href="https://tracking.test/css"><svg onload="alert(1)"><text>SVG payload</text></svg><img src="https://tracking.test/pixel" onerror="alert(1)" alt="Brand logo"><p class="fixed inset-0" style="position:fixed;background-image:url(https://tracking.test/bg);color:rgb(1, 2, 3)" onclick="alert(1)">Safe text <a href="javascript:alert(1)" id="unsafe-link">Edit me</a></p><div hidden>Hidden text</div>';
    const { container } = render(
      <EditableEmailBody ref={ref} html={malicious} />,
    );
    expect(
      container.querySelector(
        "script,style,iframe,link,svg,img,a,[href],[src],[onclick],[onerror]",
      ),
    ).toBeNull();
    const paragraph = screen
      .getByText("Safe text", { exact: false })
      .closest("p")!;
    expect(paragraph.className).toBe("");
    expect(paragraph.style.position).toBe("");
    expect(paragraph.style.backgroundImage).toBe("");
    expect(paragraph.style.color).toBe("rgb(1, 2, 3)");
    expect(screen.getByText("Brand logo")).toBeTruthy();
    expect(screen.queryByText("Hidden text")).toBeNull();
    expect(screen.queryByText("SVG payload")).toBeNull();
    expect(ref.current!.getValue().text).toContain("Safe text Edit me");
    expect(ref.current!.getValue().text).not.toMatch(/unsafe|Hidden|SVG/);
  });

  it("serializes native Enter blocks and supports a locked saving state", () => {
    const ref = createRef<EditableEmailBodyHandle>();
    const view = render(<EditableEmailBody ref={ref} html="<p>First</p>" />);
    const field = screen.getByRole("textbox");
    const line = document.createElement("div");
    line.textContent = "Second";
    field.append(line);
    fireEvent.input(field);
    expect(ref.current!.getValue().html).toContain("First<br>Second");
    view.rerender(<EditableEmailBody ref={ref} html="<p>First</p>" disabled />);
    expect(field.getAttribute("contenteditable")).toBe("false");
    expect(field.getAttribute("tabindex")).toBe("-1");
    expect(ref.current!.getValue().text).toContain("First\nSecond");
  });
});
