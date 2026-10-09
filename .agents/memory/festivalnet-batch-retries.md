---
name: FestivalNet batch retries
description: Identity and review boundaries for retrying partially completed FestivalNet batches.
---

Batch retries may resolve a previously requested new profile only by its exact FestivalNet source event ID, under the same transaction locks as creation. Name/location matches must still require a reviewed profile selection.

**Why:** A save can commit while its HTTP response is lost; retrying must not create another profile or silently choose a similarly named festival.

**How to apply:** Keep successful review entries immutable and out of subsequent requests. Preserve edited drafts on failure; recheck matches without reparsing when the name, location or target year changes. Continue using a separate atomic transaction per entry.
