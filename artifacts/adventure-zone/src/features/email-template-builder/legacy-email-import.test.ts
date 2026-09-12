import { describe, expect, it } from "vitest";

import { importLegacyEmail } from "./legacy-email-import";
import { compileEmailBuilderDocument } from "@workspace/api-zod";

describe("importLegacyEmail", () => {
  it("recognizes branded rows and preserves unfamiliar markup", () => {
    const html = `<!doctype html><html><body><table role="presentation" width="640"><tbody>
      <tr><td align="center" style="background:#0f1729;padding:20px"><img src="https://example.com/adventure-zone-logo.png" width="390" alt="The Adventure Zone"></td></tr>
      <tr><td style="background:#0f1729;padding:38px;border-bottom:7px solid #ff0a8a"><span>GREAT SEEING YOU</span><div style="font-size:49px">LET'S PLAN WHAT'S NEXT.</div><div>More community memories.</div></td></tr>
      <tr><td style="background:#f8f6f1;padding:38px"><div style="font-size:16px">Hi {{contactName}},</div><div>We would love to return to {{eventName}}.</div></td></tr>
      <tr><td><section data-special="kept"><marquee>Unfamiliar but preserved</marquee></section></td></tr>
      <tr><td style="background:#0f1729;border-top:5px solid #ff0a8a"><div>The Adventure Zone · America's Best Bounce House Carnival!</div><div>TheAdventureZone12@gmail.com · 435-760-5583</div></td></tr>
    </tbody></table></body></html>`;

    const imported = importLegacyEmail(html);

    expect(imported.document.blocks.map((block) => block.type)).toEqual([
      "logoHeader", "hero", "text", "customHtml", "customHtml",
    ]);
    expect(imported.fullyNative).toBe(false);
    expect(imported.document.blocks[3]).toMatchObject({
      type: "customHtml",
      html: expect.stringContaining("data-special=\"kept\""),
    });
    expect(imported.document.blocks[0]).toMatchObject({
      type: "logoHeader",
      sourceHtml: expect.stringContaining('align="center"'),
    });
  });

  it("preserves malformed or unrecognized HTML as a custom block", () => {
    const imported = importLegacyEmail("<div><b>Original {{eventName}}</b></div>");
    expect(imported.document.blocks).toHaveLength(1);
    expect(imported.document.blocks[0]).toMatchObject({ type: "customHtml" });
  });

  it("preserves the complete legacy shell until a visual block is edited", () => {
    const html = '<!doctype html><html><head><style>@media (max-width:680px){.old{width:100%}}</style></head><body data-original-shell="yes"><table role="presentation" width="640"><tbody><tr><td style="background:#f8f6f1;padding:38px"><div style="font-size:16px">Hi {{contactName}}</div></td></tr></tbody></table></body></html>';
    const imported = importLegacyEmail(html);

    expect(compileEmailBuilderDocument(imported.document)).toContain('data-original-shell="yes"');
    expect(compileEmailBuilderDocument(imported.document)).toContain("@media (max-width:680px)");
  });

  it("preserves rich legacy body rows instead of flattening their markup", () => {
    const html = '<table role="presentation" width="640"><tbody><tr><td style="background:#f8f6f1;padding:38px"><div style="font-size:16px">Welcome <strong>{{contactName}}</strong> — <a href="https://example.com">view details</a>.</div></td></tr></tbody></table>';
    const imported = importLegacyEmail(html);

    expect(imported.document.blocks[0]).toMatchObject({
      type: "customHtml",
      html: expect.stringContaining('<strong>{{contactName}}</strong>'),
    });
  });
});
