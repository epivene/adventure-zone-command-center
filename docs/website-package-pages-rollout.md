# Package popup and SEO rollout

Status: code prepared for review; Wix package pages and publication are pending.

The homepage keeps its current layout. Package links open a native dialog using the same package definitions as the standalone `adventure-zone-package` custom element. Modified clicks and browsers without dialog support follow the real page link. Booking selects the package in the existing inquiry form.

## Release order

1. Merge and deploy the static host release. This does not replace the immutable script currently selected in Wix.
2. Create three Wix pages, hidden from the menu but available for indexing. Add the `adventure-zone-package` custom element using the release URL below and set its `package-key` attribute as listed. Keep the site-wide header/footer from duplicating the element's header. Size the element and section for its full content on desktop and mobile; verify the existing resize-event integration before publishing.
3. Set each page's own title, description and canonical URL. Discover its actual Wix page ID first. Preserve all other SEO tags. Do not set all static pages to the same title.
4. Preview all three direct URLs and the homepage popup at desktop and mobile widths. Check Escape, Tab containment, close/backdrop, focus return, scrolling and booking selection. Do not send a production inquiry as part of UI checks.
5. Update the homepage custom element's server URL to the release asset, keeping its `adventure-zone-site` tag. Publish the coordinated Wix changes only after the package routes are ready. Never enable homepage links before their destination pages exist.
6. Verify public routes return successfully and show the correct package. Only then redirect the old Adventure Zone, Pirate's Rebellion and Warrior's Playground pages to their respective replacements. Inspect existing redirects before any write; retain old pages until replacements are verified.
7. Inspect the rendered package URLs in Google Search Console and submit the current sitemap. Search Console access and actual Google indexing have not been verified by this code change. Inquiry conversion tracking remains a separate setup step; do not report Wix's generic contact-click count as form submissions.

Release asset after deployment:

`https://adventure-zone-command-center-1.onrender.com/adventure-zone-site-20260910-package-pages.js`

| Page path | Custom element package-key | SEO title |
| --- | --- | --- |
| `/adventure-zone-package` | `adventure-zone` | Adventure Zone Inflatable Carnival Package for Fairs |
| `/pirates-rebellion-package` | `pirates-rebellion` | Pirate's Rebellion Water Carnival Package · Adventure Zone |
| `/warriors-playground-package` | `weekend-warriors` | Warrior's Playground Event Package · Adventure Zone |

Suggested descriptions:

- Adventure Zone: Explore a staffed inflatable carnival package with 10 attractions for fairs, festivals and community events. Ask about your location and event dates.
- Pirate's Rebellion: Explore Pirate's Rebellion, a water and pirate themed carnival package for summer events. See possible attractions and ask about event availability.
- Warrior's Playground: Explore Warrior's Playground, featuring action pursuit games and competitive attractions for older kids and teens. Ask about your event dates.

The public name remains Warrior's Playground; `weekend-warriors` is the existing internal key and is retained for compatibility.

## Verification

- `node artifacts/adventure-zone/scripts/test-package-pages.mjs`: three focused integration tests pass.
- `node --check artifacts/adventure-zone/public/adventure-zone-site.js`: passes.
- Existing website contract suite: 50 pass, 18 fail in the partial local checkout. The untouched baseline produces the identical 18 failures (13 missing image assets and five CSS-environment/layout assertions). No new failures were introduced by the adapted contract tests. Full repository CI and browser preview remain required before publication.

## Wix draft already saved

Homepage `gkh9m` on site `49533474-8b15-4ceb-81aa-ae00da890fe7` has a draft page-level SEO title and description:

- Title: Traveling Inflatable Carnival for Fairs | The Adventure Zone
- Description: Bring The Adventure Zone to your fair, festival, or community celebration. Explore inflatable carnival packages and ask about availability for your event.

The Wix Set response resolved these from the host page, including inherited social title/description. The write used `publish: false`. No site publication, redirects, Search Console connection, or analytics installation has been performed.
