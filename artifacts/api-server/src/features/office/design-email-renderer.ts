import { createHash } from "node:crypto";

import {
  designEmailDocumentSchema,
  type DesignEmailBlock,
  type DesignEmailDocument,
} from "@workspace/api-zod/design-studio-email";

const EMAIL_WIDTH = 600;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function textLines(value: string): string {
  return escapeHtml(value).replaceAll(/\r?\n/g, "<br>");
}

function cell(content: string, style: string): string {
  return `<tr><td style="${style}">${content}</td></tr>`;
}

function renderBlock(
  block: DesignEmailBlock,
  document: DesignEmailDocument,
): string {
  const mobileClass = block.showOnMobile ? "" : ' class="az-hide-mobile"';
  const text = textLines(block.content);
  const colors = document.brandKit;

  switch (block.type) {
    case "header":
      return `<tr${mobileClass}><td style="padding:24px 32px;background:${colors.primaryColor};color:#ffffff;font-family:Arial,sans-serif;font-size:18px;font-weight:700;letter-spacing:1px;">${text}</td></tr>`;
    case "hero": {
      const source = safeHttpsUrl(document.hero.src);
      if (!source) return "";
      return `<tr${mobileClass}><td style="padding:0;"><img src="${escapeHtml(source)}" alt="${escapeHtml(document.hero.alt)}" width="${EMAIL_WIDTH}" style="display:block;width:100%;max-width:${EMAIL_WIDTH}px;height:auto;border:0;"></td></tr>`;
    }
    case "heading":
      return `<tr${mobileClass}><td style="padding:28px 32px 12px;color:${colors.textColor};font-family:Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;">${text}</td></tr>`;
    case "paragraph":
      return `<tr${mobileClass}><td style="padding:12px 32px;color:${colors.textColor};font-family:Arial,sans-serif;font-size:16px;line-height:1.6;">${text}</td></tr>`;
    case "button": {
      const target = safeHttpsUrl(block.link);
      const label = target
        ? `<a href="${escapeHtml(target)}" style="display:inline-block;padding:13px 22px;background:${colors.accentColor};color:${colors.textColor};font-family:Arial,sans-serif;font-size:16px;font-weight:700;text-decoration:none;border-radius:4px;">${text}</a>`
        : `<span style="font-family:Arial,sans-serif;font-size:16px;font-weight:700;">${text}</span>`;
      return `<tr${mobileClass}><td style="padding:18px 32px 26px;">${label}</td></tr>`;
    }
    case "divider":
      return `<tr${mobileClass}><td style="padding:12px 32px;"><div style="height:1px;background:#d8d1c4;line-height:1px;">&nbsp;</div></td></tr>`;
    case "spacer":
      return `<tr${mobileClass}><td style="height:24px;line-height:24px;font-size:1px;">&nbsp;</td></tr>`;
    case "footer":
      return `<tr${mobileClass}><td style="padding:24px 32px;background:${colors.backgroundColor};color:${colors.textColor};font-family:Arial,sans-serif;font-size:12px;line-height:1.5;">${text}</td></tr>`;
    default:
      throw new Error("DESIGN_EMAIL_INVALID_BLOCK");
  }
}

export function parseDesignEmailDocument(content: string): DesignEmailDocument {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("DESIGN_EMAIL_INVALID_JSON");
  }
  const parsed = designEmailDocumentSchema.safeParse(value);
  if (!parsed.success) throw new Error("DESIGN_EMAIL_INVALID_DOCUMENT");
  return parsed.data;
}

export function renderDesignEmailHtml(document: DesignEmailDocument): string {
  const parsed = designEmailDocumentSchema.parse(document);
  const rows = parsed.blocks
    .map((block) => renderBlock(block, parsed))
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:620px){.az-shell{width:100%!important}.az-hide-mobile{display:none!important}}</style></head><body style="margin:0;padding:0;background:${parsed.brandKit.backgroundColor};"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${parsed.brandKit.backgroundColor};"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" class="az-shell" width="${EMAIL_WIDTH}" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:${EMAIL_WIDTH}px;background:#ffffff;">${rows}</table></td></tr></table></body></html>`;
}

export function fingerprintDesignEmailHtml(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

export type FrozenDesignEmailProject = {
  id: string;
  content: string;
  linkedOrganizationId: string | null;
  linkedContactId: string | null;
};

export type DesignEmailFreezeTransaction = {
  loadOwnedEmailProject(input: {
    projectId: string;
    accountId: string;
  }): Promise<FrozenDesignEmailProject | null>;
  insertImmutableVersion(input: {
    project: FrozenDesignEmailProject;
    accountId: string;
  }): Promise<{ id: string }>;
};

export type DesignEmailFreezeStore = {
  transaction<T>(
    callback: (transaction: DesignEmailFreezeTransaction) => Promise<T>,
  ): Promise<T>;
};

export async function freezeDesignEmailVersion(
  input: { projectId: string; accountId: string },
  store: DesignEmailFreezeStore,
): Promise<{ versionId: string; html: string; htmlFingerprint: string }> {
  return store.transaction(async (transaction) => {
    const project = await transaction.loadOwnedEmailProject(input);
    if (!project) throw new Error("DESIGN_EMAIL_NOT_FOUND");
    if (!project.linkedOrganizationId || !project.linkedContactId) {
      throw new Error("DESIGN_EMAIL_PROFILE_LINK_REQUIRED");
    }
    const document = parseDesignEmailDocument(project.content);
    const html = renderDesignEmailHtml(document);
    const version = await transaction.insertImmutableVersion({
      project,
      accountId: input.accountId,
    });
    return {
      versionId: version.id,
      html,
      htmlFingerprint: fingerprintDesignEmailHtml(html),
    };
  });
}
