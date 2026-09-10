/** Preview-only transformation. Never save this document back to a template. */
export function buildEmailPreview(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, frame, frameset, object, embed, form, base, meta, link, svg, math, template").forEach(node => node.remove());
  for (const element of doc.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ["srcdoc", "action", "formaction", "ping", "download", "xlink:href"].includes(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  for (const anchor of doc.querySelectorAll("a, area")) {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    let safe = false;
    try {
      const url = new URL(href);
      safe = ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
        && !!(url.hostname || url.pathname)
        && !/\{\{|\}\}|%7b%7b|%7d%7d|[\u0000-\u001f\u007f]/i.test(href);
    } catch { /* A relative or malformed URL is not a testable destination. */ }
    if (safe) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    } else {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
    }
  }
  const policy = doc.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
  doc.head.prepend(policy);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
