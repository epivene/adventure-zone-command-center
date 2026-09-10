import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export type SnapshotLink = {
  href: string;
  label: string;
};

export type BlockedSnapshotLink = SnapshotLink & {
  reason: "malformed_url" | "unsafe_protocol" | "unresolved_placeholder";
};

export type SnapshotLinks = {
  safeLinks: SnapshotLink[];
  blockedLinks: BlockedSnapshotLink[];
};

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function childNodes(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}

function attribute(element: Element, name: string) {
  return element.attrs.find((item) => item.name.toLowerCase() === name)?.value ?? "";
}

function textContent(node: Node): string {
  if ("value" in node && node.nodeName === "#text") return node.value;
  return childNodes(node).map(textContent).join("");
}

function linkedImageAlt(node: Node): string {
  if (isElement(node) && node.tagName.toLowerCase() === "img") {
    return attribute(node, "alt").trim();
  }
  for (const child of childNodes(node)) {
    const alt = linkedImageAlt(child);
    if (alt) return alt;
  }
  return "";
}

function labelFor(anchor: Element, normalizedHref?: string) {
  const visibleText = textContent(anchor).replace(/\s+/g, " ").trim();
  if (visibleText) return visibleText;
  const imageAlt = linkedImageAlt(anchor);
  if (imageAlt) return imageAlt;
  if (normalizedHref) return new URL(normalizedHref).hostname;
  return attribute(anchor, "href").trim() || "Unlabeled link";
}

export function extractSnapshotLinks(html: string): SnapshotLinks {
  const document = parseFragment(html);
  const safeLinks: SnapshotLink[] = [];
  const blockedLinks: BlockedSnapshotLink[] = [];
  const seenSafe = new Set<string>();
  const seenBlocked = new Set<string>();

  function visit(node: Node) {
    if (isElement(node) && node.tagName.toLowerCase() === "a") {
      const rawHref = attribute(node, "href").trim();
      let reason: BlockedSnapshotLink["reason"] | null = null;
      let normalizedHref: string | undefined;

      if (/\{\{|\}\}|%7b%7b|%7d%7d/i.test(rawHref)) {
        reason = "unresolved_placeholder";
      } else {
        try {
          const parsed = new URL(rawHref);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            reason = "unsafe_protocol";
          } else {
            normalizedHref = parsed.href;
          }
        } catch {
          reason = "malformed_url";
        }
      }

      if (reason) {
        const key = `${rawHref}\0${reason}`;
        if (!seenBlocked.has(key)) {
          seenBlocked.add(key);
          blockedLinks.push({ href: rawHref, label: labelFor(node), reason });
        }
      } else if (normalizedHref && !seenSafe.has(normalizedHref)) {
        seenSafe.add(normalizedHref);
        safeLinks.push({ href: normalizedHref, label: labelFor(node, normalizedHref) });
      }
    }
    childNodes(node).forEach(visit);
  }

  childNodes(document).forEach(visit);
  return { safeLinks, blockedLinks };
}
