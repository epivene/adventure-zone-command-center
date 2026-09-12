import type { EmailBuilderBlock } from "@workspace/api-zod";
import { emailBlockLabels } from "@/features/email-template-builder/email-builder-types";

const placeholders = ["contactName", "eventName", "eventCity", "eventState", "eventDates", "senderName", "senderPhone", "senderEmail", "packageName", "packagePrice", "packageDuration", "followUpDate", "conventionName", "personalNote", "earlyBirdDeadline"];

const labels: Record<string, string> = {
  eyebrow: "Eyebrow", headline: "Headline", highlightedText: "Highlighted headline", supportingText: "Supporting text",
  content: "Text", imageUrl: "Image URL", altText: "Alternative text", linkUrl: "Link URL", label: "Label",
  title: "Title", description: "Description", closing: "Closing", businessName: "Business name", tagline: "Tagline",
  email: "Email", phone: "Phone", websiteUrl: "Website URL", width: "Width", height: "Height", padding: "Padding",
  thickness: "Thickness", backgroundColor: "Background", textColor: "Text color", accentColor: "Accent color",
  highlightColor: "Highlight color", buttonColor: "Button color", borderColor: "Border color", cardColor: "Card color",
  color: "Color", align: "Alignment", html: "Custom HTML", contentFormat: "Text format",
};

function primaryTextField(block: EmailBuilderBlock): string | null {
  if (block.type === "text") return "content";
  if (block.type === "hero") return "headline";
  if (block.type === "offerCallout") return "title";
  if (block.type === "signature") return "closing";
  if (block.type === "footer") return "tagline";
  if (block.type === "videoThumbnail") return "label";
  return null;
}

function ScalarField({ name, value, onChange }: { name: string; value: string | number; onChange(value: string | number): void }) {
  const label = labels[name] ?? name;
  if (name === "align") return <label className="grid gap-1 text-sm font-semibold">{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>;
  if (name === "contentFormat") return <label className="grid gap-1 text-sm font-semibold">{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="plain">Plain text</option><option value="rich_text">Rich text</option></select></label>;
  if (/Color$|^color$/.test(name)) return <label className="grid gap-1 text-sm font-semibold">{label}<span className="flex gap-2"><input className="h-11 w-14 p-1" type="color" value={String(value)} onChange={(event) => onChange(event.target.value)} /><input value={value} onChange={(event) => onChange(event.target.value)} /></span></label>;
  if (typeof value === "number") return <label className="grid gap-1 text-sm font-semibold">{label}<input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
  const multiline = ["content", "supportingText", "description", "closing", "html"].includes(name);
  return <label className="grid gap-1 text-sm font-semibold">{label}{multiline ? <textarea rows={name === "html" ? 12 : 5} value={value} onChange={(event) => onChange(event.target.value)} /> : <input value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}

export function BlockSettings({ block, onUpdate }: { block: EmailBuilderBlock | null; onUpdate(patch: Record<string, unknown>): void }) {
  if (!block) return <section className="rounded-xl border bg-white p-4 text-sm text-slate-500">Select a section to edit it.</section>;
  const ignored = new Set(["id", "type", "sourceHtml", "cards", "buttons"]);
  const entries = Object.entries(block).filter(([name, value]) => !ignored.has(name) && (typeof value === "string" || typeof value === "number"));
  const target = primaryTextField(block);
  return <section className="grid gap-3 rounded-xl border bg-white p-4" aria-label={`${emailBlockLabels[block.type]} settings`}>
    <div><h3 className="font-bold">Edit {emailBlockLabels[block.type]}</h3><p className="text-xs text-slate-500">Changes appear in the email preview.</p></div>
    {entries.map(([name, value]) => <ScalarField key={name} name={name} value={value as string | number} onChange={(next) => onUpdate({ [name]: next })} />)}
    {block.type === "text" && block.contentFormat === "rich_text" ? <div className="flex flex-wrap gap-2" aria-label="Rich text tools"><button type="button" className="button-secondary" onClick={() => onUpdate({ content: `${block.content}<strong>Bold text</strong>` })}>Bold</button><button type="button" className="button-secondary" onClick={() => onUpdate({ content: `${block.content}<em>Italic text</em>` })}>Italic</button><button type="button" className="button-secondary" onClick={() => onUpdate({ content: `${block.content}<h2>Heading</h2>` })}>Heading</button><button type="button" className="button-secondary" onClick={() => onUpdate({ content: `${block.content}<a href=\"https://www.the-adventure-zone.com/\">Link text</a>` })}>Link</button></div> : null}
    {block.type === "buttonRow" ? <div className="grid gap-3">{block.buttons.map((button, index) => <fieldset key={index} className="grid gap-2 rounded-lg border p-2"><legend className="text-xs font-bold">Button {index + 1}</legend><ScalarField name="label" value={button.label} onChange={(label) => onUpdate({ buttons: block.buttons.map((item, itemIndex) => itemIndex === index ? { ...item, label: String(label) } : item) })} /><ScalarField name="linkUrl" value={button.url} onChange={(url) => onUpdate({ buttons: block.buttons.map((item, itemIndex) => itemIndex === index ? { ...item, url: String(url) } : item) })} />{block.buttons.length > 1 ? <button type="button" className="button-secondary" onClick={() => onUpdate({ buttons: block.buttons.filter((_, itemIndex) => itemIndex !== index) })}>Remove button {index + 1}</button> : null}</fieldset>)}{block.buttons.length < 2 ? <button type="button" className="button-secondary" onClick={() => onUpdate({ buttons: [...block.buttons, { label: "LEARN MORE", url: "https://www.the-adventure-zone.com/" }] })}>Add button</button> : null}</div> : null}
    {block.type === "packageCards" ? <div className="grid gap-3">{block.cards.map((card, index) => <fieldset key={index} className="grid gap-2 rounded-lg border p-2"><legend className="text-xs font-bold">Card {index + 1}</legend><ScalarField name="label" value={card.label} onChange={(label) => onUpdate({ cards: block.cards.map((item, itemIndex) => itemIndex === index ? { ...item, label: String(label) } : item) })} /><ScalarField name="imageUrl" value={card.imageUrl} onChange={(imageUrl) => onUpdate({ cards: block.cards.map((item, itemIndex) => itemIndex === index ? { ...item, imageUrl: String(imageUrl) } : item) })} /><ScalarField name="altText" value={card.altText} onChange={(altText) => onUpdate({ cards: block.cards.map((item, itemIndex) => itemIndex === index ? { ...item, altText: String(altText) } : item) })} /><ScalarField name="linkUrl" value={card.linkUrl} onChange={(linkUrl) => onUpdate({ cards: block.cards.map((item, itemIndex) => itemIndex === index ? { ...item, linkUrl: String(linkUrl) } : item) })} />{block.cards.length > 1 ? <button type="button" className="button-secondary" onClick={() => onUpdate({ cards: block.cards.filter((_, itemIndex) => itemIndex !== index) })}>Remove card {index + 1}</button> : null}</fieldset>)}{block.cards.length < 3 ? <button type="button" className="button-secondary" onClick={() => onUpdate({ cards: [...block.cards, { label: "NEW PACKAGE", imageUrl: "https://www.the-adventure-zone.com/favicon.ico", altText: "Adventure Zone package", linkUrl: "https://www.the-adventure-zone.com/" }] })}>Add card</button> : null}</div> : null}
    {target ? <label className="grid gap-1 text-sm font-semibold">Insert placeholder<select aria-label="Insert placeholder" defaultValue="" onChange={(event) => { if (!event.target.value) return; onUpdate({ [target]: `${String((block as unknown as Record<string, unknown>)[target] ?? "")} {{${event.target.value}}}`.trim() }); event.target.value = ""; }}><option value="">Choose a field…</option>{placeholders.map((token) => <option key={token} value={token}>{`{{${token}}}`}</option>)}</select></label> : null}
  </section>;
}
