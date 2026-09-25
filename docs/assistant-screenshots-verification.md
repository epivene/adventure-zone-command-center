# Assistant screenshots: implementation and verification

The owner workspace accepts up to four still PNG, JPEG or WebP screenshots per message (5 MiB each), from the file picker, paste or drag/drop. Image-only questions are supported. Pending images can be removed before send; successful uploads and message request keys survive a retry. Saved screenshots load through authenticated private reads and can be opened at full size.

The backend stores immutable metadata and SHA-256-checked private objects. Upload/read/message routes enforce owner and workspace gates. Models receive actual Responses `input_image` content. Older screenshot IDs are available in history and can be read by a scoped tool. Every model read checks actor, conversation, user source cutoff and attachment binding. At most four images enter a model call. Checkpoints contain descriptors, never base64 image bytes. Storage hydration respects cancellation and the model deadline. Screenshots cannot authorize actions or verify payments/signatures.

Startup migration adds message attachment metadata and the private screenshot table; readiness verifies both. Storage is lazy, so text-only chat does not require a new storage connection. No model or secret settings are changed.

## Validation

- Assistant CI backend selection: 50 files / 236 tests pass on Node 22.23.2 (289.26 seconds), including storage, model vision payloads, older-image lookup, checkpoint recovery, cancellation, authenticated HTTP routes and connected business workflows.
- Workspace UI: 7 files / 20 tests pass after the final implementation changes.
- API and frontend production builds pass on Node 22.23.2.
- API/UI typechecks retain the existing 94/135 errors. The diagnostic file/code inventory matches the activation baseline; no assistant or screenshot diagnostics. One unrelated booking type union is printed in a different order.
- A fresh gpt-6-astra reviewer inspected the full implementation at local commit `15f8184`: no Critical, Important or Minor findings, no declined judgments. All local regression/build gates passed.

## Boundaries

- Container, MIME, byte-size and dimensions are checked locally; final pixel decoding is performed by OpenAI. A corrupt compressed image may still produce a failed reply; the message remains saved.
- Unbound private uploads are retained for reliable retries; there is no expiry/deletion job in this change.
- Live browser upload and actual model reading await the reviewed PR being merged and deployed. Unit/integration tests use controlled provider/storage substitutes; they do not establish a production vision result.
- Local validation uses the project's Node 22 runtime. Hosted Actions must be checked separately.

## Publication safety

All 29 changed paths were compared with remote main `ffebaa295d2260bb13052929f6e3357f74c7f9f2`; each existing path matches the local implementation base. Publish by overlaying these reviewed files onto that remote tree, preserving unrelated profiles, promotional assets, attachments and import seeds.
