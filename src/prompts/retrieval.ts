/**
 * Retrieval prompt — the user-facing block appended to the system prompt.
 *
 * `{{context}}` is the numbered chunk list produced by `ContextBuilder`.
 * `{{sources}}` is a human-readable summary of the same sources for
 * double-checking by the LLM (title + page + URL). `{{query}}` is the
 * user's original question.
 */
export const RETRIEVAL_PROMPT = `Context:
{{context}}

Sources:
{{sources}}

User question: {{query}}

Answer:`;
