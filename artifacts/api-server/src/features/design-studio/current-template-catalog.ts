import { eq } from "drizzle-orm";

import type { db as databaseClient } from "@/db/client";
import { contractTemplateV1 } from "@/features/contracts/contract-template-v1";
import { communicationTemplates } from "@workspace/db/business-source-schema";
import { designTemplates } from "@workspace/db/design-studio-schema";

export const CURRENT_CATALOG_REVISION = 1;

type EmailTemplateDefinition = {
  code: string;
  name: string;
  category: string;
  subject: string;
  intro: string;
  body: string;
  includePackages?: boolean;
  includeFoam?: boolean;
};

const PACKAGE_BLOCK = `
  <div style="margin:24px 0;padding:20px;border:1px solid #eadde5;border-radius:16px;background:#fff8fb">
    <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#df1762">CURRENT PACKAGE OPTIONS</div>
    <p style="margin:10px 0 0;color:#202030">{{package_summary_html}}</p>
    <p style="margin:14px 0 0"><a href="{{website_url}}" style="color:#df1762;font-weight:700">Tap to learn more!</a></p>
  </div>`;

const FOAM_BLOCK = `
  <div style="margin:20px 0;padding:18px;border-radius:16px;background:#e9f8ff;border:1px solid #b7e7f8">
    <strong style="color:#15324a">Foam Party Add-On | {{foam_party_price}}</strong>
    <p style="margin:8px 0 0;color:#30475b">Add an extra burst of fun to a confirmed package.</p>
    <p style="margin:10px 0 0"><a href="{{foam_party_url}}" style="color:#0878a8;font-weight:700">See the Foam Party</a></p>
  </div>`;

function brandedEmail(definition: EmailTemplateDefinition): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f5f1f4;font-family:Arial,sans-serif;color:#202030">
  <div style="max-width:680px;margin:0 auto;background:#ffffff">
    <div style="padding:18px 28px;text-align:center;border-bottom:4px solid #df1762">
      <img src="{{logo_url}}" alt="The Adventure Zone" width="150" style="display:inline-block;max-width:150px;height:auto">
    </div>
    <div style="padding:30px 32px">
      <p style="margin:0 0 18px">Hi {{contact_name}},</p>
      <h1 style="margin:0 0 18px;font-size:26px;line-height:1.2;color:#151525">${definition.intro}</h1>
      <div style="font-size:16px;line-height:1.65;color:#343443">${definition.body}</div>
      ${definition.includePackages ? PACKAGE_BLOCK : ""}
      ${definition.includeFoam ? FOAM_BLOCK : ""}
      <p style="margin:26px 0 0">Warmly,<br><strong>The Adventure Zone</strong><br>{{sender_phone}}</p>
    </div>
    <div style="padding:16px 28px;text-align:center;background:#151525;color:#ffffff;font-size:12px">
      America's Best Bounce House Carnival! | Fully insured
    </div>
  </div>
</body></html>`;
}

export const CURRENT_EMAIL_TEMPLATES: EmailTemplateDefinition[] = [
  {
    code: "email.general_first_outreach",
    name: "General first outreach",
    category: "outreach",
    subject: "The Adventure Zone for {{event_name}}",
    intro: "Bring something unforgettable to {{event_name}}",
    body: "<p>We would love to learn more about your event and see whether one of our traveling inflatable carnival packages could be a good fit.</p><p>Would you have a moment to talk about what you are planning?</p>",
    includePackages: true,
    includeFoam: true,
  },
  {
    code: "email.past_customer_return",
    name: "Past customer: We want to come back",
    category: "returning_customer",
    subject: "The Adventure Zone wants to come back to {{event_name}}",
    intro: "We had a great time with you",
    body: "<p>We loved being part of {{event_name}}, and we would be excited to come back for {{event_year}}.</p><p>Do you have a moment to talk about next year's event?</p>",
    includePackages: true,
    includeFoam: true,
  },
  {
    code: "email.returning_customer_offer",
    name: "Returning customer offer",
    category: "returning_customer",
    subject: "The Adventure Zone returning customer option for {{event_name}}",
    intro: "A current option for your next event",
    body: "<p>We would love to work with you again. Based on our conversation, the current option is <strong>{{package_name}}</strong> at <strong>{{package_price}}</strong>.</p><p>Let me know if you would like us to prepare the next step.</p>",
    includeFoam: true,
  },
  {
    code: "email.adventure_zone_focus",
    name: "Adventure Zone focused",
    category: "package",
    subject: "The Adventure Zone package for {{event_name}}",
    intro: "Our full inflatable carnival experience",
    body: "<p>The Adventure Zone brings 10 attractions with a balanced mix of slides, obstacles, play areas, and games. Current starting rate: <strong>{{adventure_zone_price}}</strong>.</p><p>It works best when an event wants a broad experience for a wide range of ages.</p>",
    includeFoam: true,
  },
  {
    code: "email.warriors_focus",
    name: "Warrior's Playground focused",
    category: "package",
    subject: "The Adventure Zone Warrior's Playground for {{event_name}}",
    intro: "Five attractions built for action",
    body: "<p>Warrior's Playground is our five-attraction competition-focused option, with a current starting rate of <strong>{{warriors_price}}</strong>.</p><p>It is a strong fit for events that want more challenge, movement, and friendly competition.</p>",
    includeFoam: true,
  },
  {
    code: "email.pirates_focus",
    name: "Pirate's Rebellion focused",
    category: "package",
    subject: "The Adventure Zone Pirate's Rebellion for {{event_name}}",
    intro: "A pirate-themed warm-weather favorite",
    body: "<p>Pirate's Rebellion is our three-attraction water-focused option, with a current starting rate of <strong>{{pirates_price}}</strong>.</p><p>We can talk through the event layout, water access, and timing to see whether it fits your plans.</p>",
    includeFoam: true,
  },
  {
    code: "email.mini_zone_focus",
    name: "Mini Zone for a smaller event",
    category: "package",
    subject: "The Adventure Zone Mini Zone for {{event_name}}",
    intro: "Five attractions in a smaller setup",
    body: "<p>Mini Zone is designed for events that need a tighter footprint or lower starting price. It includes five family attractions and currently starts at <strong>{{mini_zone_price}}</strong>.</p>",
    includeFoam: true,
  },
  {
    code: "email.no_reply_followup",
    name: "Follow-up: no reply",
    category: "follow_up",
    subject: "Following up from The Adventure Zone",
    intro: "I wanted to follow up again",
    body: "<p>I wanted to make sure my earlier note did not get lost. Do you have a moment to talk about {{event_name}}?</p><p>You can email us back here or give us a call at {{sender_phone}}.</p>",
  },
  {
    code: "email.proposal_contract_followup",
    name: "Proposal or contract follow-up",
    category: "follow_up",
    subject: "The Adventure Zone follow-up for {{event_name}}",
    intro: "Checking in on the next step",
    body: "<p>I wanted to follow up on the {{document_type}} we sent for {{event_name}}. Do you have a moment to review it, or is there anything you would like us to adjust?</p>",
  },
  {
    code: "email.after_convention",
    name: "After-convention follow-up",
    category: "follow_up",
    subject: "It was great meeting you and The Adventure Zone",
    intro: "It was great connecting with you",
    body: "<p>I enjoyed meeting you at {{convention_name}}. I wanted to send a little more information about what The Adventure Zone can bring to community events.</p>",
    includePackages: true,
    includeFoam: true,
  },
  {
    code: "email.after_event_review",
    name: "After-event thank-you and review",
    category: "after_event",
    subject: "Thank you from The Adventure Zone",
    intro: "Thank you for having us",
    body: `<p>We had a great time at {{event_name}} and appreciate the opportunity to be part of it.</p><p>If you have a moment, we would love to hear how we did.</p><p><a href="{{review_link}}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#df1762;color:#fff;text-decoration:none;font-weight:700">Leave a Review</a></p>`,
  },
  {
    code: "email.contract_ready",
    name: "Contract ready",
    category: "contract",
    subject: "The Adventure Zone contract for {{event_name}}",
    intro: "Your contract is ready",
    body: `<p>Your contract for {{event_name}} is ready to review.</p><p><a href="{{contract_link}}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#df1762;color:#fff;text-decoration:none;font-weight:700">Review the Contract</a></p><p>Please let us know if any event detail needs to be corrected before signing.</p>`,
  },
  {
    code: "email.signed_contract_received",
    name: "Signed contract received",
    category: "contract",
    subject: "The Adventure Zone received your signed contract",
    intro: "We received your signed contract",
    body: "<p>We have received the signed contract for {{event_name}}. We will keep moving through the remaining booking steps and will be in touch if anything else is needed.</p>",
  },
  {
    code: "email.deposit_received",
    name: "Deposit received",
    category: "payment",
    subject: "The Adventure Zone received your deposit",
    intro: "Your deposit has been received",
    body: "<p>We received the deposit for {{event_name}}. Your profile has been updated, and we will continue preparing for the event.</p>",
  },
];

export const CONTRACT_ARRANGEMENTS = [
  "guaranteed_fee",
  "pay_for_play",
  "guarantee_plus_percentage",
] as const;

export const CONTRACT_PACKAGE_SELECTIONS = [
  "adventure_zone",
  "weekend_warriors",
  "pirates_rebellion",
  "mini_zone",
  "multi_package",
] as const;

const PACKAGE_LABELS: Record<(typeof CONTRACT_PACKAGE_SELECTIONS)[number], string> = {
  adventure_zone: "Adventure Zone",
  weekend_warriors: "Warrior's Playground",
  pirates_rebellion: "Pirate's Rebellion",
  mini_zone: "Mini Zone",
  multi_package: "Multi-package / custom",
};

const ARRANGEMENT_LABELS: Record<(typeof CONTRACT_ARRANGEMENTS)[number], string> = {
  guaranteed_fee: "Guaranteed fee",
  pay_for_play: "Pay-for-play",
  guarantee_plus_percentage: "Guarantee plus percentage",
};

export const CURRENT_CONTRACT_TEMPLATES = CONTRACT_ARRANGEMENTS.flatMap((arrangement) =>
  CONTRACT_PACKAGE_SELECTIONS.map((packageCode) => ({
    catalogKey: `contract.${arrangement}.${packageCode}`,
    name: `${PACKAGE_LABELS[packageCode]} | ${ARRANGEMENT_LABELS[arrangement]}`,
    arrangement,
    packageCode,
    content: JSON.stringify({
      heading: "The Adventure Zone Event Agreement",
      arrangement,
      packageCode,
      eventFields: {
        eventName: "{{event_name}}",
        eventDates: "{{event_dates}}",
        eventLocation: "{{event_location}}",
        operatingHours: "{{operating_hours}}",
      },
      financialFields: {
        guaranteedFee: "{{guaranteed_fee}}",
        percentage: "{{percentage}}",
        deposit: "{{deposit}}",
        balanceDue: "{{balance_due}}",
      },
      optionalAddOns: [{ code: "foam_party", price: "{{foam_party_price}}", selected: false }],
      adventureZoneClauses: contractTemplateV1.adventureZoneClauses,
      sponsorClauses: contractTemplateV1.sponsorClauses,
      forceMajeureClause: contractTemplateV1.forceMajeureClause,
      signatures: { sponsor: "", adventureZone: "" },
    }, null, 2),
  })),
);

export const CURRENT_PROPOSAL_TEMPLATES = [
  ["proposal.prepaid.adventure_zone", "Adventure Zone prepaid", "prepaid", "adventure_zone"],
  ["proposal.prepaid.weekend_warriors", "Warrior's Playground prepaid", "prepaid", "weekend_warriors"],
  ["proposal.prepaid.pirates_rebellion", "Pirate's Rebellion prepaid", "prepaid", "pirates_rebellion"],
  ["proposal.prepaid.mini_zone", "Mini Zone prepaid", "prepaid", "mini_zone"],
  ["proposal.pay_for_play", "Pay-for-play proposal", "pay_for_play", "multi_package"],
  ["proposal.guarantee_plus_percentage", "Guarantee plus percentage proposal", "guarantee_plus_percentage", "multi_package"],
  ["proposal.multi_package", "Multi-package / custom proposal", "custom", "multi_package"],
] as const;

const ALLOWED_PLACEHOLDERS = [
  "contact_name", "organization_name", "event_name", "event_year",
  "package_name", "package_price", "package_summary_html", "website_url",
  "logo_url", "foam_party_url", "foam_party_price", "sender_phone",
  "adventure_zone_price", "warriors_price", "pirates_price", "mini_zone_price",
  "document_type", "convention_name", "review_link", "contract_link",
];

function revisionOf(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function ensureCurrentTemplateCatalog(
  database: typeof databaseClient,
): Promise<void> {
  for (const definition of CURRENT_EMAIL_TEMPLATES) {
    const [existing] = await database
      .select()
      .from(communicationTemplates)
      .where(eq(communicationTemplates.code, definition.code))
      .limit(1);
    const values = {
      code: definition.code,
      templateVersion: String(CURRENT_CATALOG_REVISION),
      name: definition.name,
      channel: "email" as const,
      category: definition.category,
      subjectTemplate: definition.subject,
      bodyTemplate: brandedEmail(definition),
      bodyFormat: "html" as const,
      allowedPlaceholders: ALLOWED_PLACEHOLDERS,
      requiredPlaceholders: ["contact_name"],
      accessScope: "owner" as const,
      state: "active" as const,
      ownerKind: "company" as const,
      createdByKind: "system" as const,
      sourceNote: "Adventure Zone current Design Studio catalog",
      reviewedBy: "Dave confirmed package facts",
      reviewedAt: new Date(),
      updatedAt: new Date(),
    };
    if (!existing) {
      await database.insert(communicationTemplates).values(values);
    } else if (revisionOf(existing.templateVersion) < CURRENT_CATALOG_REVISION) {
      await database
        .update(communicationTemplates)
        .set(values)
        .where(eq(communicationTemplates.id, existing.id));
    } else if (existing.state === "archived" && revisionOf(existing.templateVersion) === CURRENT_CATALOG_REVISION) {
      await database
        .update(communicationTemplates)
        .set({ state: "active", updatedAt: new Date() })
        .where(eq(communicationTemplates.id, existing.id));
    }
  }

  const designDefinitions = [
    ...CURRENT_EMAIL_TEMPLATES.map((definition) => ({
      catalogKey: definition.code,
      name: definition.name,
      type: "email" as const,
      templateFamily: "email" as const,
      description: "Current branded Adventure Zone email template.",
      tags: ["email", definition.category],
      content: brandedEmail(definition),
      lockedContent: { brand: true, communicationCode: definition.code },
    })),
    ...CURRENT_CONTRACT_TEMPLATES.map((definition) => ({
      catalogKey: definition.catalogKey,
      name: definition.name,
      type: "contract" as const,
      templateFamily: "contract" as const,
      description: "Current protected contract clauses with editable event and negotiated terms.",
      tags: ["contract", definition.arrangement, definition.packageCode],
      content: definition.content,
      lockedContent: {
        legal: true,
        arrangement: definition.arrangement,
        packageCode: definition.packageCode,
      },
    })),
    ...CURRENT_PROPOSAL_TEMPLATES.map(([catalogKey, name, arrangement, packageCode]) => ({
      catalogKey,
      name,
      type: "proposal" as const,
      templateFamily: "proposal" as const,
      description: "Current proposal format with editable event details and optional Foam Party add-on.",
      tags: ["proposal", arrangement, packageCode],
      content: JSON.stringify({
        heading: name,
        arrangement,
        packageCode,
        eventName: "{{event_name}}",
        packageName: "{{package_name}}",
        packagePrice: "{{package_price}}",
        attractionCount: "{{package_attraction_count}}",
        marketingFootprint: "{{package_marketing_footprint}}",
        summary: "{{package_customer_description}}",
        optionalAddOns: [{ code: "foam_party", price: "{{foam_party_price}}", selected: false }],
      }, null, 2),
      lockedContent: { brand: true, arrangement, packageCode },
    })),
  ];

  for (const definition of designDefinitions) {
    const [existing] = await database
      .select()
      .from(designTemplates)
      .where(eq(designTemplates.catalogKey, definition.catalogKey))
      .limit(1);
    const values = {
      ...definition,
      catalogRevision: CURRENT_CATALOG_REVISION,
      visibility: "approved" as const,
      isApproved: true,
      state: "active" as const,
      archivedAt: null,
      updatedAt: new Date(),
    };
    if (!existing) {
      await database.insert(designTemplates).values(values);
    } else if (existing.catalogRevision < CURRENT_CATALOG_REVISION) {
      await database
        .update(designTemplates)
        .set(values)
        .where(eq(designTemplates.id, existing.id));
    } else if (existing.state === "archived" && existing.catalogRevision === CURRENT_CATALOG_REVISION) {
      await database
        .update(designTemplates)
        .set({ state: "active", archivedAt: null, updatedAt: new Date() })
        .where(eq(designTemplates.id, existing.id));
    }
  }
}
