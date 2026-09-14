import type { EmailBuilderBlock, EmailBuilderDocument } from "./email-template-builder";

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textWithBreaks(value: string): string {
  return escapeText(value).replace(/\r?\n/g, "<br>");
}

function safeDestination(value: string): string {
  const trimmed = value.trim();
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(trimmed) || /^\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/.test(trimmed)) {
    return escapeText(trimmed);
  }
  return "";
}

function decodeAttributeValue(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);?/g, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&(colon|tab|newline);/gi, (_, name: string) => name.toLowerCase() === "colon" ? ":" : " ");
}

function isAllowedAttributeDestination(name: string, value: string): boolean {
  const normalized = decodeAttributeValue(value).replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
  if (!normalized) return true;
  if (/^https?:\/\//.test(normalized)) return true;
  if (name.toLowerCase() === "href" && /^(?:mailto:|tel:)/.test(normalized)) return true;
  return name.toLowerCase() === "src" && /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(normalized);
}

function hasUnsafeCss(value: string): boolean {
  const decoded = decodeAttributeValue(value)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/[\u0000-\u0020\u007f"']/g, "")
    .toLowerCase();
  return /expression\s*\(|@import|behavior\s*:|-moz-binding|url\s*\(/.test(decoded);
}

export function sanitizeCustomEmailHtml(html: string): string {
  let value = html;
  const safeStyleBlocks: string[] = [];
  value = value.replace(/<\s*(script|iframe|frame|frameset|object|embed|form|svg|math|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  value = value.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css: string) => {
    if (hasUnsafeCss(css)) return "";
    const index = safeStyleBlocks.push(`<style>${css}</style>`) - 1;
    return `__AZ_SAFE_STYLE_BLOCK_${index}__`;
  });
  value = value.replace(/<\s*\/?\s*style\b[^>]*>/gi, "");
  value = value.replace(/<\s*\/?\s*(script|iframe|frame|frameset|object|embed|form|input|button|textarea|select|option|svg|math|template|meta|link|base)\b[^>]*>/gi, "");
  value = value.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  value = value.replace(/\s+(?:srcdoc|action|formaction|xlink:href|ping)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  value = value.replace(/\s+(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (attribute, name: string, doubleQuoted: string | undefined, singleQuoted: string | undefined, unquoted: string | undefined) => {
    const destination = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
    return isAllowedAttributeDestination(name, destination) ? attribute : "";
  });
  value = value.replace(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (attribute, doubleQuoted: string | undefined, singleQuoted: string | undefined, unquoted: string | undefined) => {
    const style = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
    return hasUnsafeCss(style) ? "" : attribute;
  });
  value = value.replace(/(?:url\s*\(\s*['"]?\s*(?:javascript|vbscript|data:text\/html)[^)]*\)|expression\s*\([^)]*\))/gi, "");
  value = value.replace(/__AZ_SAFE_STYLE_BLOCK_(\d+)__/g, (_, index: string) => safeStyleBlocks[Number(index)] ?? "");
  return value;
}

function row(content: string, backgroundColor: string, padding: number, extra = ""): string {
  return `<tr><td style="background:${backgroundColor};padding:${padding}px;${extra}">${content}</td></tr>`;
}

function sanitizeRichText(html: string): string {
  const sanitized = sanitizeCustomEmailHtml(html)
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<\/?(?!p\b|h[1-3]\b|strong\b|b\b|em\b|i\b|u\b|ul\b|ol\b|li\b|br\b|a\b)[a-z][^>]*>/gi, "");
  return sanitized.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (_tag, name: string, attributes: string) => {
    const lower = name.toLowerCase();
    if (lower !== "a") return `<${lower}>`;
    const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const destination = href?.[1] ?? href?.[2] ?? href?.[3] ?? "";
    return destination ? `<a href="${escapeText(destination)}" target="_blank" rel="noopener noreferrer">` : "<a>";
  });
}

function buttonHtml(label: string, url: string, background: string, color: string): string {
  const href = safeDestination(url);
  const opening = href ? `<a href="${href}" target="_blank" rel="noopener noreferrer"` : "<span";
  const closing = href ? "</a>" : "</span>";
  return `${opening} class="az-button" style="display:inline-block;padding:14px 22px;background:${background};color:${color}!important;-webkit-text-fill-color:${color}!important;border:2px solid ${background};font-size:13px;line-height:16px;font-weight:800;letter-spacing:.7px;text-decoration:none">${escapeText(label)}${closing}`;
}

function renderBlock(block: EmailBuilderBlock): string {
  if (block.sourceHtml) return sanitizeCustomEmailHtml(block.sourceHtml);
  switch (block.type) {
    case "logoHeader": {
      const image = `<img src="${escapeText(block.imageUrl)}" width="${block.width}" alt="${escapeText(block.altText)}" style="display:block;width:${block.width}px;max-width:92%;height:auto;margin:${block.align === "center" ? "0 auto" : block.align === "right" ? "0 0 0 auto" : "0 auto 0 0"};border:0">`;
      return row(image, block.backgroundColor, block.padding, `text-align:${block.align}`);
    }
    case "hero":
      return row(
        `<div style="font-size:12px;line-height:16px;font-weight:800;letter-spacing:1.2px;color:${block.accentColor}">${escapeText(block.eyebrow)}</div>`
        + `<div style="font-size:46px;line-height:48px;font-weight:900;letter-spacing:-1.4px;color:${block.textColor};margin-top:16px">${textWithBreaks(block.headline)}${block.highlightedText ? `<br><span style="color:${block.highlightColor}">${textWithBreaks(block.highlightedText)}</span>` : ""}</div>`
        + `<div style="width:86px;height:5px;background:${block.accentColor};margin:19px 0 17px"></div>`
        + `<div style="font-size:16px;line-height:25px;font-weight:600;color:${block.textColor};max-width:520px">${textWithBreaks(block.supportingText)}</div>`,
        block.backgroundColor,
        block.padding,
        `border-bottom:7px solid ${block.accentColor}`,
      );
    case "text":
      return row(`<div style="font-size:16px;line-height:25px;color:${block.textColor};text-align:${block.align}">${block.contentFormat === "rich_text" ? sanitizeRichText(block.content) : textWithBreaks(block.content)}</div>`, block.backgroundColor, block.padding);
    case "image": {
      const image = `<img src="${escapeText(block.imageUrl)}" width="${block.width}"${block.height ? ` height="${block.height}"` : ""} alt="${escapeText(block.altText)}" style="display:block;width:100%;max-width:${block.width}px;${block.height ? `height:${block.height}px;object-fit:cover;` : "height:auto;"}margin:0 auto;border:2px solid ${block.borderColor};box-sizing:border-box">`;
      const href = safeDestination(block.linkUrl);
      return row(href ? `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:block;text-decoration:none">${image}</a>` : image, block.backgroundColor, block.padding, "text-align:center");
    }
    case "videoThumbnail": {
      const href = safeDestination(block.linkUrl);
      const content = `<img src="${escapeText(block.imageUrl)}" width="612" alt="${escapeText(block.altText)}" style="display:block;width:100%;height:auto;border:2px solid ${block.borderColor};box-sizing:border-box"><div style="padding:10px;font-size:13px;font-weight:800;text-align:center;color:#0f1729">${escapeText(block.label)}</div>`;
      return row(`<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:block;text-decoration:none">${content}</a>`, block.backgroundColor, block.padding);
    }
    case "packageCards": {
      const width = Math.floor(100 / block.cards.length);
      const cards = block.cards.map((card) => `<td class="az-card" width="${width}%" valign="top" style="background:${block.cardColor};border:2px solid ${block.accentColor}"><a href="${safeDestination(card.linkUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;text-decoration:none"><img src="${escapeText(card.imageUrl)}" width="180" alt="${escapeText(card.altText)}" style="display:block;width:100%;height:110px;object-fit:cover;border:0"><div style="padding:14px 12px 16px;font-size:12px;line-height:16px;font-weight:900;color:${block.textColor};-webkit-text-fill-color:${block.textColor}">${textWithBreaks(card.label)}</div></a></td>`).join('<td class="az-card-gap" width="3%"></td>');
      return row(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr class="az-stack">${cards}</tr></table>`, block.backgroundColor, block.padding);
    }
    case "offerCallout":
      return row(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${block.backgroundColor};border:2px solid ${block.accentColor}"><tr><td style="padding:${block.padding}px"><div style="font-size:12px;line-height:16px;font-weight:800;letter-spacing:1.2px;color:${block.accentColor}">${escapeText(block.eyebrow)}</div><div style="margin-top:7px;font-size:24px;line-height:30px;font-weight:900;color:${block.textColor}">${textWithBreaks(block.title)}</div><div style="margin-top:10px;font-size:15px;line-height:23px;color:${block.textColor}">${textWithBreaks(block.description)}</div></td></tr></table>`, "#f8f6f1", 14);
    case "buttonRow": {
      const cells = block.buttons.map((button) => `<td class="az-button-cell" align="${block.align}">${buttonHtml(button.label, button.url, block.buttonColor, block.textColor)}</td>`).join('<td class="az-button-gap" width="15"></td>');
      return row(`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:${block.align === "center" ? "0 auto" : block.align === "right" ? "0 0 0 auto" : "0"}"><tr class="az-stack">${cells}</tr></table>`, block.backgroundColor, block.padding, `text-align:${block.align}`);
    }
    case "divider":
      return row(`<div style="height:${block.thickness}px;background:${block.color};font-size:0;line-height:0">&nbsp;</div>`, block.backgroundColor, block.padding);
    case "spacer":
      return `<tr><td height="${block.height}" style="height:${block.height}px;background:${block.backgroundColor};font-size:0;line-height:0">&nbsp;</td></tr>`;
    case "signature":
      return row(`<div style="font-size:16px;line-height:24px;color:${block.textColor}">${textWithBreaks(block.closing)}</div>`, block.backgroundColor, block.padding);
    case "footer": {
      const website = safeDestination(block.websiteUrl);
      return row(`<div style="font-size:12px;line-height:19px;font-weight:700;color:${block.textColor}">${escapeText(block.businessName)} · ${escapeText(block.tagline)}</div><div style="font-size:11px;line-height:18px;color:${block.textColor};margin-top:6px"><a href="mailto:${escapeText(block.email)}" style="color:${block.textColor}!important;-webkit-text-fill-color:${block.textColor};text-decoration:none">${escapeText(block.email)}</a> · ${escapeText(block.phone)} · <a href="${website}" target="_blank" rel="noopener noreferrer" style="color:${block.textColor}!important;-webkit-text-fill-color:${block.textColor};text-decoration:none">the-adventure-zone.com</a></div>`, block.backgroundColor, block.padding, `text-align:center;border-top:5px solid ${block.accentColor}`);
    }
    case "customHtml":
      return sanitizeCustomEmailHtml(block.html);
  }
}

export function compileEmailBuilderDocument(document: EmailBuilderDocument): string {
  if (document.settings.sourceHtml) return sanitizeCustomEmailHtml(document.settings.sourceHtml);
  const preheader = document.settings.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeText(document.settings.preheader)}</div>`
    : "";
  const blocks = document.blocks.map(renderBlock).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:680px){.az-email{width:100%!important}.az-stack,.az-stack>td{display:block!important;width:100%!important}.az-card-gap,.az-button-gap{display:block!important;width:100%!important;height:12px!important}.az-button-cell{text-align:center!important}.az-button{display:block!important;text-align:center!important}}</style></head><body style="margin:0;padding:0;background:${document.settings.backgroundColor};font-family:Arial,Helvetica,sans-serif">${preheader}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:${document.settings.backgroundColor}"><tr><td align="center"><table role="presentation" class="az-email" width="${document.settings.contentWidth}" cellspacing="0" cellpadding="0" style="width:${document.settings.contentWidth}px;max-width:100%;margin:0 auto">${blocks}</table></td></tr></table></body></html>`;
}
