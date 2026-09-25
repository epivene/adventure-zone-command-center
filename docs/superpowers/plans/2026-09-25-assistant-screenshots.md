# Assistant screenshot attachments

User requirement: “I have to be able to give it screenshots.” Extend the already enabled owner workspace and its configured OpenAI models. Follow the established implementation → draft PR → user merge workflow.

## Acceptance

- Owner can choose images on phone/desktop, paste or drop them, preview/remove before sending, and send an image without text.
- Up to four still PNG/JPEG/WebP files, 5 MiB each. Friendly validation and upload errors preserve pending work.
- Uploaded images remain private, belong to one conversation, and are restored in saved messages. Read access uses owner authentication.
- OpenAI receives actual visual input. Follow-ups can inspect earlier screenshots, including older messages outside recent context.
- Server owns image metadata and run scope. The model cannot read another actor/conversation's images or images after its source message. Screenshot text is untrusted evidence, not authority to write/send or proof of payments/signatures.
- Upload and send retry use stable IDs; exact repeats do not duplicate a message/run. Switching conversations during upload cannot send or clear the new chat.
- Persist descriptors only, hydrate bytes immediately before the provider call, cap model images at four, and respect cancellation during hydration.

## Tasks

1. Map chat/provider/storage interfaces, add private immutable image metadata storage, startup migration and readiness checks; prove attachment persistence, ownership and atomic retry.
2. Wire binary routes, scoped history image tool, checkpoint metadata and Responses image inputs; implement picker/paste/drop, authenticated saved previews and retry-safe composer.
3. Run focused tests and existing assistant CI selection, production builds and baseline type comparison. Obtain fresh whole-branch review, fix Important findings, and publish only reviewed changes on current remote main.

## Review focus

Actor/conversation/source cutoff; storage retry after interrupted put; valid and malformed image containers; image tool restoration after restart; cancellation during slow storage reads; actual Responses image payload/order/size; mobile picker and paste/drop; navigation races; uncertain send retries; migration/readiness compatibility; preserving unrelated remote files.

## Deliberate boundaries

Reuse configured private object storage and the current model allowlist. This is screenshot input, not arbitrary PDF/video ingestion or automatic Gmail sending. Container/type/size/dimension validation runs locally; OpenAI performs final image decoding. Private unbound uploads are retained to make retries safe, with no automatic expiry in this change. Saved screenshots follow the existing conversation retention behavior.
