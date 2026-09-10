import { describe, expect, it } from "vitest";
import { buildEmailPreview } from "./email-preview";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
describe("clickable email previews", () => {
  it("opens linked images and text outside the preview without changing layout", () => {
    const doc = parse(buildEmailPreview('<table><tr><td style="background:#0f1729"><a href="https://example.com/watch?a=1&amp;b=2" target="_top"><img src="https://example.com/logo.png" width="390"></a><a href="https://example.com/options">Options</a></td></tr></table>'));
    const links = [...doc.querySelectorAll("a")];
    expect(links.map(a => a.target)).toEqual(["_blank", "_blank"]);
    expect(links[0].href).toBe("https://example.com/watch?a=1&b=2");
    expect(links[0].rel).toBe("noopener noreferrer");
    expect(doc.querySelector("img")?.getAttribute("width")).toBe("390");
    expect(doc.querySelector("td")?.getAttribute("style")).toBe("background:#0f1729");
  });
  it("keeps email and telephone actions clickable", () => {
    const doc = parse(buildEmailPreview('<a href="mailto:hello@example.com?subject=Hello">Email</a><a href="tel:+14357605583">Call</a>'));
    expect([...doc.querySelectorAll("a")].map(a => a.getAttribute("href"))).toEqual(["mailto:hello@example.com?subject=Hello", "tel:+14357605583"]);
  });
  it("blocks unsafe, relative and unresolved destinations", () => {
    const doc = parse(buildEmailPreview('<a href="javascript:alert(1)">Bad</a><a href="data:text/html,bad">Bad</a><a href="/admin">Relative</a><a href="https://example.com/{{eventName}}">Unresolved</a><a href="https://example.com/%7b%7bevent%7d%7d">Encoded</a>'));
    expect(doc.querySelectorAll("a[href]")).toHaveLength(0);
    expect(doc.body.textContent).toContain("Unresolved");
  });
  it("removes executable content and automatic navigation before popups are enabled", () => {
    const doc = parse(buildEmailPreview('<base target="_top"><meta http-equiv="refresh" content="0;url=https://example.com"><script>alert(1)</script><iframe src="https://example.com"></iframe><form action="https://example.com"><input></form><svg><a href="https://example.com">SVG</a></svg><a href="https://example.com" onclick="alert(1)" ping="https://example.com/track" download>Go</a>'));
    expect(doc.querySelector("script,iframe,form,svg,base,[onclick],[ping],[download]")).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("script-src 'none'");
  });
});
