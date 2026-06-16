/**
 * Citation prompt fragment — appended to the system prompt when the
 * downstream service wants to make the citation rules extra explicit
 * (e.g. for evaluation suites or the eval judge).
 */
export const CITATION_PROMPT = `Citation rules (strict):
- Use ONLY the [N] format for citations. Do not use footnotes, URLs, or parenthetical references.
- Place the citation marker immediately after the sentence it supports, with no extra punctuation between the claim and the marker.
- If a sentence is supported by more than one source, place all relevant markers together, e.g. [1][3].
- If you cannot ground a claim in the provided Sources, do not state it.`;
