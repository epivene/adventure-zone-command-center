/** Target only the convention header; retain each message's authored headline and body. */
export function updateConventionHeader(html: string): string {
  if (html.includes('data-convention-header="v1"')) return html;
  return html.replace(
    /<tr>\s*<td\b[^>]*>\s*(<img\b[^>]*adventure-zone-logo-(?:navy|tagline-20260910)\.png[^>]*>)\s*<\/td>\s*<\/tr>\s*<tr>\s*(<td\b[^>]*>)\s*<span\b[^>]*class="[^"]*eyebrow"[^>]*>[\s\S]*?<\/span>/i,
    (_match, image: string, heroCell: string) => {
      const logo = image.replace(/\s(?:width|style)="[^"]*"/gi, '')
        .replace(/>$/, ' width="390" style="display:block;width:390px;max-width:100%;height:auto;border:0;transform:rotate(10deg);transform-origin:center">');
      return `<tr data-convention-header="v1"><td style="background:#0f1729;padding:30px 38px 12px"><style>@media only screen and (max-width:480px){.az-header-column{display:block!important;width:100%!important;box-sizing:border-box}.az-header-label{padding-top:14px!important}.az-header-logo img{margin:0 auto!important}}</style><table role="presentation" width="100%" cellspacing="0" cellpadding="0" dir="rtl"><tr><td class="az-header-column az-header-logo" width="65%" dir="ltr" align="right" style="padding:16px 20px 28px">${logo}</td><td class="az-header-column az-header-label" width="35%" dir="ltr" valign="bottom" style="padding:0 0 12px;text-align:left;font-family:Georgia,serif;font-size:12px;line-height:18px;font-weight:800;letter-spacing:1.2px;color:#ff0a8a">IT’S CONVENTION SEASON!</td></tr></table></td></tr><tr>${heroCell}`;
    },
  );
}
