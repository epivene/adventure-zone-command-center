# Drag-and-Drop Email Template Editor Design

**Date:** 2026-09-11
**Status:** Approved in conversation; awaiting written-spec review

## Goal

Replace the raw body textarea in Communication Templates with a visual, mobile-friendly editor that can create and edit emails matching the quality and structure of the current Adventure Zone branded drafts. The generated email must remain compatible with the existing Gmail draft, template rendering, and placeholder flows.

Success means an owner can reproduce the current navy, pink, yellow, and cream campaign emails—including logo headers, large hero banners, body copy, images or linked video thumbnails, package cards, offer callouts, buttons, and footer—without hand-writing HTML.

## Scope

The first release covers the owner-facing Communication Templates page and its reusable email templates. It preserves the existing template list, lifecycle, permissions, placeholders, archive action, and shared-template promotion. The retired Send to Dave action does not appear in the editor.

The editor will support:

- creating a branded HTML email from an Adventure Zone starter layout or a blank canvas;
- dragging new sections into the canvas and reordering existing sections;
- touch-safe Up and Down controls as an alternative to dragging on mobile;
- editing content and visual settings for each section;
- desktop and mobile previews of the compiled email;
- undo, redo, duplicate, and delete actions;
- inserting supported template placeholders into editable text and link fields;
- opening existing HTML templates without losing their current output;
- viewing and editing advanced HTML when needed.

Direct image-file hosting is not a new responsibility of this feature. Image blocks will accept an existing image URL and provide quick choices for known Adventure Zone assets already hosted by the app or website. A separate media-upload workflow can be connected later without changing the block document format.

## Editor Experience

On desktop, the editor uses three areas:

1. A compact section library containing the available blocks.
2. A central email canvas that shows the actual section order and approximate email appearance.
3. A settings panel for the selected section.

On narrow screens, the canvas remains primary. The section library and selected-section settings open in anchored panels, and each canvas section exposes Up, Down, Duplicate, and Delete controls. The interface will not require precise drag gestures to complete any operation.

The subject remains a normal editable field above the canvas. A Desktop/Mobile preview switch changes only the preview width; it never changes the saved HTML. Save Changes remains explicit and shows dirty, saving, saved, and error states. Switching templates with unsaved changes requires confirmation.

## Supported Blocks

The initial block library contains:

- **Logo Header:** Adventure Zone logo, background, width, alignment, and padding.
- **Hero Banner:** eyebrow, headline, highlighted headline text, supporting text, accent rule, colors, and spacing.
- **Text:** rich text appropriate for email, including paragraphs, headings, bold, italic, links, alignment, and placeholders.
- **Image:** source URL, alt text, linked destination, sizing, border, crop behavior, and spacing.
- **Video Thumbnail:** image plus destination URL and accessible play/link labeling; it links to the website video page rather than embedding unsupported video.
- **Package Cards:** one to three image cards with label and link, responsive stacking, and Adventure Zone styling.
- **Offer Callout:** eyebrow, title, description, border/background colors, and optional deadline placeholder.
- **Button Row:** one or two email-safe buttons with labels, URLs, colors, and alignment.
- **Divider and Spacer:** controlled separation without hand-entered markup.
- **Signature:** editable closing text and sender placeholders.
- **Footer:** Adventure Zone contact information and links using branded colors.
- **Custom HTML:** preserved HTML for structures the visual importer cannot safely translate.

Brand presets provide the established navy, pink, yellow, cream, white, and body-text colors, along with the current logo and commonly used package imagery. Controls still allow intentional overrides.

## Document and HTML Model

Each visual template has two coordinated representations:

- an editor document containing a versioned JSON array of typed blocks and their settings;
- the compiled `bodyTemplate` HTML used by all existing send, render, preview, and approval paths.

The database adds a nullable JSON editor-document field and an editor-document version. Existing code that only understands `bodyTemplate` continues to work unchanged. Every visual save validates the editor document, compiles it to email-safe HTML, validates placeholders, and stores both representations in the same database update.

Compilation is deterministic. The same editor document always produces the same HTML. Output uses a centered 640-pixel presentation-table structure, inline styles for essential formatting, responsive CSS for stacking, meaningful alt text, and links that remain usable in Gmail. No scripts, forms, embedded frames, SVG, or runtime JavaScript are permitted in saved email output.

## Existing Template Compatibility

Existing templates must open without visually changing the email.

When a template has no editor document, the app runs a conservative importer:

1. Recognized Adventure Zone structures are converted into native blocks.
2. Unrecognized or ambiguous structures are preserved verbatim in one or more Custom HTML blocks.
3. The editor compares compiled output with the original before considering the import complete.
4. The original `bodyTemplate` remains unchanged until the owner explicitly saves.

Custom HTML blocks can be reordered alongside native blocks and edited through Advanced HTML. The editor will never silently discard markup it does not understand. Opening a legacy template is therefore safe even if only part of it can be visually converted.

Advanced HTML has two levels:

- a source editor for a selected Custom HTML block;
- a whole-email source view for inspection and expert correction.

If whole-email HTML is manually changed, the editor reimports it conservatively. Unsupported sections become Custom HTML blocks rather than being removed.

## Placeholders

The existing placeholder allowlist remains authoritative. The editor displays friendly labels and inserts the exact `{{token}}` form. Placeholders may be used in subject text, text content, headings, button labels or destinations where valid, and relevant image/link fields.

Saving is blocked when placeholder syntax is malformed or a token is not allowed. The preview substitutes the same example values already used by Communication Templates while the stored document and HTML retain the real tokens.

## API and Validation

The existing create and update endpoints accept an optional editor document. Requests with a document are compiled server-side; the server does not trust HTML generated only in the browser. Requests without a document retain current behavior for compatibility with older clients and nonvisual templates.

Validation covers:

- document version and recognized block types;
- required block fields and reasonable text/URL/spacing limits;
- allowed URL schemes;
- allowed placeholders and balanced placeholder syntax;
- a maximum document size and block count;
- removal or rejection of dangerous markup in Custom HTML;
- successful compilation to nonempty email HTML.

If compilation or validation fails, neither representation is saved. The user sees a plain-language error that identifies the affected section when possible.

## Undo and Recovery

Undo and redo operate on editor-document changes during the current editing session. Destructive block actions are reversible through Undo. The current explicit Save action remains the persistence boundary.

Before changing templates or leaving the editor with unsaved work, the app warns the user. A failed save leaves the local canvas unchanged so corrections can be made and retried.

## Testing and Acceptance

Unit tests will cover block schemas, each block compiler, escaping, placeholder retention, Custom HTML sanitization, deterministic compilation, and legacy importing. Component tests will cover adding, reordering, editing, duplicating, deleting, undoing, previewing, mobile move controls, unsaved-change protection, and saving.

API tests will verify atomic storage of document and HTML, rejection of unsafe or invalid content, continued support for legacy requests, and unchanged rendering/approval behavior.

The feature is accepted only when:

1. A user can visually recreate the current approved branded draft structure without typing HTML.
2. Existing branded templates open and preview without losing content or styling.
3. The generated email remains readable and branded in desktop and mobile Gmail-sized previews.
4. Placeholder rendering and Gmail draft creation continue to use the compiled HTML correctly.
5. Every editor action needed on desktop also has a practical touch/mobile control.

## Out of Scope

- replacing Gmail or the existing email-draft composer;
- bulk campaign sending;
- a general-purpose website/page builder;
- arbitrary JavaScript or interactive email widgets;
- a new asset-storage service;
- adding template editing controls to Dave's screen.
