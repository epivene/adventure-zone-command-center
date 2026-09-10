const videoPages: Record<string, string> = {
  MWD0SdAWZpc: "adventure-zone-package",
  tgjwa1LvghI: "pirates-rebellion-package",
  "-xTjCJz9RmI": "warriors-playground-package",
};

/** Replace only our three known video destinations; preserve all authored content. */
export function replaceEmailVideoLinks(html: string): string {
  return html.replace(/(<a\b[^>]*\bhref\s*=\s*)(["'])([^"']+)\2/gi,
    (match, prefix: string, quote: string, href: string) => {
      try {
        const url = new URL(href.replace(/&amp;/g, "&"));
        if (url.protocol !== "https:" && url.protocol !== "http:") return match;
        const host = url.hostname.toLowerCase();
        const id = host === "youtu.be" ? url.pathname.slice(1)
          : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
            ? url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1]
            : null;
        const page = id && Object.hasOwn(videoPages, id) ? videoPages[id] : null;
        return page ? `${prefix}${quote}https://www.the-adventure-zone.com/${page}${quote}` : match;
      } catch { return match; }
    });
}
