import { ilike } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { bossAccounts, communicationTemplates } from "@/db/schema";
import { BossWorkRequestService, templateFingerprint } from "@/features/boss-work-requests/boss-work-request-service";

type Database = NodePgDatabase<typeof schema>;

const photos = {
  hero: "https://static.wixstatic.com/media/81786c_03c4528320c64347805d5ecfb2d15fc6~mv2.jpg/v1/fill/w_700,h_700,al_c,q_85/81786c_03c4528320c64347805d5ecfb2d15fc6~mv2.jpg",
  action: "https://static.wixstatic.com/media/81786c_53777ae5a685418aa8b0f2d2cc1a3389~mv2.jpg/v1/fill/w_960,h_638,al_c,q_85/81786c_53777ae5a685418aa8b0f2d2cc1a3389~mv2.jpg",
  slide: "https://static.wixstatic.com/media/81786c_41e3ae81e9f7495f82d6f7a40a8624ec~mv2.png/v1/fill/w_600,h_530,al_c,q_85/81786c_41e3ae81e9f7495f82d6f7a40a8624ec~mv2.png",
};

function earlyBird() {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;background:#fff4f8;border:2px solid #ef1763;border-radius:14px"><tr><td style="padding:20px"><div style="font:800 13px Arial,sans-serif;letter-spacing:1.5px;color:#ef1763;text-transform:uppercase">Early Bird</div><div style="margin-top:6px;font:700 21px Arial,sans-serif;color:#171717">Save 10% when your deposit is in by {{earlyBirdDeadline}}</div><p style="margin:8px 0 0;font:15px/1.5 Arial,sans-serif;color:#333">I’m offering this across the upcoming season for a short time, so it’s a good chance to lock in your date early.</p></td></tr></table>`;
}

function layout(kicker: string, heading: string, intro: string, middle: string, image: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:white;border-radius:18px;overflow:hidden"><tr><td style="background:#ef1763;padding:18px 24px;color:white;font:800 13px Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase">The Adventure Zone · ${kicker}</td></tr><tr><td><img src="${image}" width="620" alt="Adventure Zone inflatable attraction" style="display:block;width:100%;height:auto"></td></tr><tr><td style="padding:28px 28px 8px"><h1 style="margin:0;font:800 31px/1.1 Arial,sans-serif;color:#171717">${heading}</h1><p style="margin:16px 0 0;font:16px/1.6 Arial,sans-serif;color:#333">Hi {{contactName}},</p><p style="margin:12px 0 0;font:16px/1.6 Arial,sans-serif;color:#333">${intro}</p><p style="margin:12px 0 0;font:16px/1.6 Arial,sans-serif;color:#333">{{personalNote}}</p>${middle}${earlyBird()}<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td style="border-radius:999px;background:#ef1763"><a href="https://www.the-adventure-zone.com/" style="display:inline-block;padding:13px 22px;color:white;text-decoration:none;font:700 15px Arial,sans-serif">See The Adventure Zone</a></td></tr></table></td></tr><tr><td style="background:#171717;padding:20px 28px;color:white;font:14px/1.5 Arial,sans-serif"><strong>The Adventure Zone</strong><br><a href="mailto:{{senderEmail}}" style="color:#ff79ab">{{senderEmail}}</a> · {{senderPhone}}</td></tr></table></td></tr></table></body></html>`;
}

export const conventionCampaignTemplates = [
  {
    code: "convention_pre_event_v1",
    templateVersion: "2026-09-approved-design-v1",
    name: "Convention Campaign — Before the Convention",
    subjectTemplate: "A fun idea for {{eventName}} before {{conventionName}}",
    bodyTemplate: layout(
      "Before the convention",
      "Let’s make {{eventName}} impossible to walk past.",
      "I’m looking forward to {{conventionName}} and wanted to introduce an attraction setup that brings the energy of a midway without adding another ride operator to your list.",
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td style="padding:16px;background:#ef1763;color:white;font:700 17px Arial,sans-serif">10 attractions · Adventure Zone</td></tr><tr><td style="padding:16px;background:#ffedf4;font:700 17px Arial,sans-serif">5 attractions · Weekend Warriors</td></tr><tr><td style="padding:16px;background:#ef1763;color:white;font:700 17px Arial,sans-serif">3 attractions · Pirates Rebellions</td></tr></table>`,
      photos.hero,
    ),
  },
  {
    code: "convention_during_event_v1",
    templateVersion: "2026-09-approved-design-v1",
    name: "Convention Campaign — Met at the Convention",
    subjectTemplate: "Great meeting you at {{conventionName}}",
    bodyTemplate: layout(
      "Great meeting you",
      "Slide into action!",
      "It was great talking with you at {{conventionName}}. I kept thinking about what you shared and how The Adventure Zone could fit {{eventName}}.",
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;background:#ffedf4"><tr><td width="48%" style="padding:8px"><img src="${photos.action}" width="270" alt="Adventure Zone action attraction" style="display:block;width:100%;height:auto"></td><td width="52%" style="padding:18px;font:15px/1.5 Arial,sans-serif;color:#222"><strong style="font-size:19px">Built for busy event days</strong><br>Flexible package sizes, a self-contained crew, and a bright attraction area that gives families a reason to stay longer.</td></tr></table>`,
      photos.slide,
    ),
  },
  {
    code: "convention_post_event_v1",
    templateVersion: "2026-09-approved-design-v1",
    name: "Convention Campaign — Follow-up After the Convention",
    subjectTemplate: "Let’s keep the fun going for {{eventName}}",
    bodyTemplate: layout(
      "Convention follow-up",
      "A memorable family zone, without more work for your team.",
      "I enjoyed meeting you at {{conventionName}}. I wanted to send the package overview we discussed and make it easy to keep the conversation going.",
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border-collapse:separate;border-spacing:8px"><tr><td style="padding:16px;background:#ef1763;color:white;font:700 16px Arial,sans-serif">Adventure Zone<br><span style="font-weight:400">10 attractions</span></td><td style="padding:16px;background:#ffedf4;font:700 16px Arial,sans-serif">Weekend Warriors<br><span style="font-weight:400">5 attractions</span></td><td style="padding:16px;background:#ef1763;color:white;font:700 16px Arial,sans-serif">Pirates Rebellions<br><span style="font-weight:400">3 attractions</span></td></tr></table>`,
      photos.action,
    ),
  },
] as const;

export async function ensureConventionCampaignTemplateSeed(database: Database): Promise<void> {
  const service = new BossWorkRequestService(database);
  const dave = (await database.select({ id: bossAccounts.id }).from(bossAccounts)
    .where(ilike(bossAccounts.displayName, "%dave%")).limit(1))[0];

  for (const item of conventionCampaignTemplates) {
    const inserted = await database.insert(communicationTemplates).values({
      ...item,
      channel: "email",
      category: "convention_campaign",
      accessScope: "office",
      state: "draft",
      bodyFormat: "html",
      allowedPlaceholders: ["contactName", "eventName", "conventionName", "personalNote", "earlyBirdDeadline", "senderEmail", "senderPhone"],
      requiredPlaceholders: ["contactName", "eventName", "conventionName", "earlyBirdDeadline"],
      ownerKind: "company",
      createdByKind: "system",
      sourceNote: "Canonical conversion of the approved convention campaign design. Gmail draft IDs were unavailable at migration time.",
      reviewedBy: null,
    }).onConflictDoNothing({ target: communicationTemplates.code }).returning();
    const template = inserted[0] ?? (await database.select().from(communicationTemplates)
      .where(ilike(communicationTemplates.code, item.code)).limit(1))[0];
    if (!template || !dave || template.state === "active") continue;
    const fingerprint = templateFingerprint({
      templateVersion: template.templateVersion,
      subjectTemplate: template.subjectTemplate,
      bodyTemplate: template.bodyTemplate,
      bodyFormat: template.bodyFormat,
    });
    await service.createOwnerRequest({
      type: "email_template_approval",
      assignedBossAccountId: dave.id,
      title: `Review email template: ${template.name}`,
      instructions: "Please preview this convention email and approve it or leave notes for changes.",
      priority: "normal",
      dueAt: null,
      deduplicationKey: `template-review:${template.id}:${fingerprint}`,
      templateId: template.id,
      ownerId: "system:convention-template-seed",
    });
  }
}
