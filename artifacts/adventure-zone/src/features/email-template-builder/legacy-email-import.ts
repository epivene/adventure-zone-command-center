import type { EmailBuilderBlock, EmailBuilderDocument } from "@workspace/api-zod";

import { adventureZoneBrand, createEmailBlock } from "./email-builder-types";

function nextId(type: EmailBuilderBlock["type"], index: number) {
  return `imported-${type}-${index}`;
}

function styleContains(element: Element, fragment: string): boolean {
  return (element.getAttribute("style") ?? "").toLowerCase().replaceAll(" ", "").includes(fragment.toLowerCase().replaceAll(" ", ""));
}

function importRow(row: HTMLTableRowElement, index: number): EmailBuilderBlock {
  const cell = row.cells[0];
  const text = (cell?.textContent ?? "").replace(/\s+/g, " ").trim();
  const image = cell?.querySelector("img");
  const isNavy = cell ? styleContains(cell, "#0f1729") : false;

  if (cell && image && isNavy && /adventure.?zone|logo/i.test(`${image.getAttribute("src") ?? ""} ${image.getAttribute("alt") ?? ""}`)) {
    return {
      ...createEmailBlock("logoHeader", nextId("logoHeader", index)),
      imageUrl: image.getAttribute("src") ?? "",
      altText: image.getAttribute("alt") ?? "The Adventure Zone",
      width: Number(image.getAttribute("width")) || 390,
      sourceHtml: row.outerHTML,
    } as EmailBuilderBlock;
  }

  if (cell && isNavy && (styleContains(cell, "border-bottom:7px") || !!cell.querySelector('[style*="font-size:49"], [style*="font-size: 49"]'))) {
    const large = cell.querySelector('[style*="font-size:49"], [style*="font-size: 49"]');
    const highlighted = large?.querySelector("span")?.textContent?.trim() ?? "";
    const headlineNode = large?.cloneNode(true) as Element | undefined;
    headlineNode?.querySelector("span")?.remove();
    const divs = [...cell.querySelectorAll(":scope > div")];
    return {
      ...createEmailBlock("hero", nextId("hero", index)),
      eyebrow: cell.querySelector(":scope > span")?.textContent?.trim() ?? "",
      headline: headlineNode?.textContent?.replace(/\s+/g, " ").trim() || text,
      highlightedText: highlighted,
      supportingText: divs.at(-1)?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      sourceHtml: row.outerHTML,
    } as EmailBuilderBlock;
  }

  if (cell && /TheAdventureZone12@gmail\.com/i.test(text) && (isNavy || styleContains(cell, "border-top:5px"))) {
    const divisions = [...cell.querySelectorAll(":scope > div")];
    const heading = divisions[0]?.textContent?.trim() ?? "";
    const separator = heading.indexOf("·");
    const email = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
    const phone = text.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/)?.[0];
    const website = [...cell.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href") ?? "").find((href) => /^https?:\/\//i.test(href));
    if (separator > 0 && email && phone && website) {
      return {
        ...createEmailBlock("footer", nextId("footer", index)),
        businessName: heading.slice(0, separator).trim(),
        tagline: heading.slice(separator + 1).trim(),
        email,
        phone,
        websiteUrl: website,
        sourceHtml: row.outerHTML,
      } as EmailBuilderBlock;
    }
  }

  if (cell && styleContains(cell, adventureZoneBrand.cream) && cell.querySelector('[style*="font-size:16"], [style*="font-size: 16"]') && !cell.querySelector("a,strong,b,em,i,img,table")) {
    const paragraphs = [...cell.children].map((child) => child.textContent?.replace(/\s+/g, " ").trim()).filter(Boolean);
    return { ...createEmailBlock("text", nextId("text", index)), content: paragraphs.join("\n\n"), sourceHtml: row.outerHTML } as EmailBuilderBlock;
  }

  return { id: nextId("customHtml", index), type: "customHtml", html: row.outerHTML };
}

export function importLegacyEmail(html: string): { document: EmailBuilderDocument; fullyNative: boolean } {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const tables = [...parsed.querySelectorAll("table")];
  const emailTable = tables.find((table) => table.getAttribute("width") === "640") ?? tables.find((table) => table.rows.length > 1);
  const directRows = emailTable?.tBodies[0] ? [...emailTable.tBodies[0].children].filter((element): element is HTMLTableRowElement => element instanceof HTMLTableRowElement) : [];
  const blocks = directRows.length ? directRows.map(importRow) : [{ id: nextId("customHtml", 0), type: "customHtml" as const, html }];
  return {
    document: { version: 1, settings: { backgroundColor: adventureZoneBrand.cream, contentWidth: 640, sourceHtml: html }, blocks },
    fullyNative: blocks.every((block) => block.type !== "customHtml"),
  };
}
