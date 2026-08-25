export type LocalAssistantIntent =
  | "exact_cached_answer"
  | "semantic_cached_search"
  | "cloud_required";

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[?!.,'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const exactPatterns = [
  /\bwhat time\b/,
  /\bwhat (?:date|day)\b/,
  /\bwhen (?:is|was|does|did|will)\b/,
  /\b(?:start|starting|end|ending) time\b/,
  /\b(?:event|booking) schedule\b/,
  /follow ?up/,
  /next action/,
  /what .* due/,
  /call due/,
  /main contact/,
  /primary contact/,
  /who should i call/,
  /\bnormally\b/,
  /usually .* book/,
  /usual package/,
  /what happened last year/,
  /what did they book last year/,
  /last year .* book/,
];

const cloudPatterns = [
  /\bdraft\b/,
  /\bwrite (?:me )?(?:an?|the)? ?(?:email|message|proposal|text|script)\b/,
  /\bcompose\b/,
  /\bsend (?:an?|the)? ?(?:email|message|text)\b/,
  /\bresearch\b/,
  /search (?:the )?web/,
  /find (?:a |some )?new (?:event|fair|festival|lead|prospect)/,
  /find events? (?:around|near|between|along)/,
  /\bstrateg(?:y|ic|ically)\b/,
  /\brecommend\b/,
  /which .* should we prioritize/,
];

const semanticPatterns = [
  /\bmention(?:ed)?\b/,
  /\bcomplain(?:ed|t)?\b/,
  /\bpromise(?:d)?\b/,
  /\bnote\b/,
  /\bremember\b/,
  /what .* said/,
  /anything about/,
  /find the .* (?:note|comment|mention)/,
  /\bwater(?: hookup)?\b/,
  /\bpower\b/,
  /\belectric(?:al|ity)?\b/,
  /\binsurance\b/,
  /\bspace\b/,
  /\bhookup\b/,
  /\bsetup area\b/,
];

export function routeLocalAssistantQuestion(question: string): LocalAssistantIntent {
  const normalized = normalize(question);
  if (!normalized) return "cloud_required";
  if (exactPatterns.some((pattern) => pattern.test(normalized))) return "exact_cached_answer";
  if (cloudPatterns.some((pattern) => pattern.test(normalized))) return "cloud_required";
  if (semanticPatterns.some((pattern) => pattern.test(normalized))) return "semantic_cached_search";
  return "cloud_required";
}
