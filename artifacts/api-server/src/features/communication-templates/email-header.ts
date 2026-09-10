/** Target only the convention header; retain each message's authored headline and body. */
export function updateConventionHeader(html: string, code = ""): string {
  const label = code.startsWith("convention_during_") ? "WE’RE HERE! LET’S CONNECT!"
    : code.startsWith("convention_after_") ? "LET’S KEEP THE MOMENTUM GOING!"
    : "IT’S CONVENTION SEASON!";
  return buildConventionHeader(html).replace(/(<tr data-convention-header="v)2("[\s\S]*?<div style="font-family:Georgia,serif;[^"]*">)IT’S CONVENTION SEASON!(<\/div>)/,
    (_match, start, header, end) => `${start}3${header}${label}${end}`);
}

function buildConventionHeader(html: string): string {
  if (html.includes('data-convention-header="v2"')) return html;
  // Fold the previously shipped two-row header back into the common input shape.
  const normalized = html.replace(
    /<tr data-convention-header="v1">([\s\S]*?)<\/table><\/td><\/tr><tr>(<td\b[^>]*>)/i,
    (match, header: string, heroCell: string) => {
      const image = header.match(/<img\b[^>]*adventure-zone-logo-(?:navy|tagline-20260910)\.png[^>]*>/i)?.[0];
      return image ? `<tr><td>${image}</td></tr><tr>${heroCell}<span class="eyebrow">IT’S CONVENTION SEASON!</span>` : match;
    },
  );
  return normalized.replace(
    /<tr>\s*<td\b[^>]*>\s*(<img\b[^>]*adventure-zone-logo-(?:navy|tagline-20260910)\.png[^>]*>)\s*<\/td>\s*<\/tr>\s*<tr>\s*<td\b[^>]*>\s*<span\b[^>]*class="[^"]*eyebrow"[^>]*>[\s\S]*?<\/span>/i,
    (_match, image: string) => {
      const logo = image.replace(/\s(?:width|style)="[^"]*"/gi, '')
        .replace(/>$/, ' width="390" style="display:block;width:390px;max-width:100%;height:auto;border:0;transform:rotate(10deg);transform-origin:center">');
      // A single cell removes the table-row seam. The reserved overlap puts the
      // tagline beside the first headline line, with a stacked narrow-screen fallback.
      return `<tr data-convention-header="v2"><td style="background:#0f1729;padding:20px 38px 36px;border:0;border-bottom:7px solid #ff0a8a;text-align:left"><style>@media only screen and (max-width:480px){.az-header-logo{width:100%!important;margin-bottom:8px!important;box-sizing:border-box}.az-header-logo img{margin:0 auto!important}}</style><div class="az-header-logo" style="width:390px;max-width:100%;box-sizing:border-box;padding:20px 18px 28px;margin:0 0 -76px auto">${logo}</div><div style="font-family:Georgia,serif;font-size:12px;line-height:18px;font-weight:800;letter-spacing:1.2px;color:#ff0a8a">IT’S CONVENTION SEASON!</div>`;
    },
  );
}

