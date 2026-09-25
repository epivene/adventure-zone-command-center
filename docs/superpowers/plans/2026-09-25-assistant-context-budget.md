# Assistant drafting context budget repair

User reports a BBQ Days deposit follow-up stopping at 280,437 tokens and 9 steps with no draft. Live UI confirms that result; raw production checkpoint/tool trace is not exposed through the authorized UI.

## Root causes verified in code

Every model call receives all 53 tool schemas (58,812 JSON characters). Tool results frequently contain a source in both data and evidence.text, and accumulated evidence is repeated again in instructions. Template discovery returns every approved template's full HTML. Instructions require calendar/documents for every commercial request irrespective of relevance. Budget checks occur between calls, so pending tool calls may remain unexecuted when the last call crosses the cap.

## Fix and acceptance

1. Project model input so source bodies and evidence appear once; preserve original checkpoint/tool data, evidence provenance, distinct versions, completion flags and receipts. Existing source/context authorization remains unchanged.
2. Expose common drafting/read tools directly with a discovery function for all other existing tools. Persist discovered names in the run checkpoint, validate them against current actor-visible definitions, and retain availability after restart. Discovery never performs the requested action or grants permission.
3. Page through template metadata, then retrieve one approved current template by ID. Narrow prerequisite instructions to relevant evidence and report budget stops with truthful draft/action status. Do not raise spending limits or execute pending writes after cutoff.
4. Test regressions and realistic request-size reductions through the real adapter, run established assistant CI/build gates, obtain fresh independent review, then prepare a draft PR on current remote main. Actual model completion remains a live deployment acceptance check.

## Review focus

No evidence loss; changed source versions/corrections; PostgreSQL JSON key ordering on checkpoint reload; unavailable tool discovery/actor scope; legacy checkpoint recovery; typed template pagination/current version; pending mutations at a budget stop; truthful stopped-run output; private screenshot compatibility.
