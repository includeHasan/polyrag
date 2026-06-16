/**
 * Evaluation prompts — used by the LLM-as-judge pipeline to score
 * groundedness / faithfulness of generated answers.
 *
 * Each prompt is designed to be a complete instruction for a single
 * grading call. The judge is expected to reply with a single integer
 * score 0–10 (faithfulness, relevance) or 0/1 (citation validity).
 */

export const FAITHFULNESS_PROMPT = `You are a strict grader scoring the FAITHFULNESS of an answer to a question, given the provided context.

Faithfulness = every claim in the answer is supported by the context. Hallucinated facts, invented numbers, or claims not present in the context should drop the score.

Question:
{query}

Context:
{context}

Answer:
{answer}

Output ONLY a single integer 0-10, where 10 = perfectly faithful (no unsupported claims) and 0 = entirely hallucinated. Score:`;

export const RELEVANCE_PROMPT = `You are a strict grader scoring the RELEVANCE of an answer to a question.

Relevance = the answer directly addresses the question, does not go off-topic, and does not omit key points that the context could support.

Question:
{query}

Context:
{context}

Answer:
{answer}

Output ONLY a single integer 0-10, where 10 = fully relevant and 0 = completely irrelevant. Score:`;

export const CITATION_VALIDITY_PROMPT = `You are a strict grader checking whether every citation marker in the answer actually corresponds to a source that supports the claim.

Sources:
{sources}

Answer:
{answer}

For every [N] marker in the answer, decide whether the source N in the Sources block supports the claim it follows. Output 1 if all citations are valid, 0 if any citation is invalid or fabricated. Output ONLY 0 or 1. Score:`;
