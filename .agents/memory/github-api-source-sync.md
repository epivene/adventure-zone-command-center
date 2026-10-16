---
name: GitHub API source synchronization
description: Safety checks when using the GitHub connector instead of local Git authentication.
---

GitHub tree API paths must be relative to the repository root, including the artifact directory. Verify the resulting commit's changed paths before updating the branch.

**Why:** A connector-based update used artifact-relative paths and created unused root-level source copies. Local builds passed, but the deployed artifact did not receive the changes.

**How to apply:** Derive API paths from the repository's tracked paths. Compare the proposed tree against the intended source changes; do not treat a successful commit creation as proof that the application source changed.

Check the current remote branch before updating it and preserve any newer commits. Use non-force ref updates. Connector-created commits do not automatically update local Git objects or tracking refs.

**Why:** Remote main can advance independently during local merge resolution, and stale local refs can conceal divergence.

**How to apply:** Distinguish local merge completion from remote synchronization. For GitHub REST, read an individual ref through git/ref/heads/main, but update it through git/refs/heads/main.

When uploading existing local commits through the connector, preserve their exact identities rather than creating replacement commits with the same files.

**Why:** Matching trees and commit SHAs keeps local and GitHub history aligned instead of creating unnecessary divergence for the next pull.

**How to apply:** Preserve commit metadata and message, verify uploaded tree and commit SHAs before a non-force branch update, then advance the local remote-tracking ref only after verifying GitHub.
