/**
 * Tiny in-memory prompt registry.
 *
 * On module load we pre-register the canonical prompts (system, retrieval,
 * citation, evaluation). Callers can `getPrompt(name)` to retrieve a
 * template, or `registerPrompt(name, template)` to add or override.
 *
 * Templates use `{{key}}` placeholders. Replacement is done at the call
 * site with the consumer's chosen engine; this module does not perform
 * substitution itself.
 */
import { logger } from "../shared/logger.js";
import { CITATION_PROMPT } from "./citation.js";
import { CITATION_VALIDITY_PROMPT, FAITHFULNESS_PROMPT, RELEVANCE_PROMPT } from "./evaluation.js";
import { RETRIEVAL_PROMPT } from "./retrieval.js";
import { SYSTEM_PROMPT } from "./system.js";

const store = new Map<string, string>();

function register(name: string, template: string): void {
  if (store.has(name)) {
    logger.debug({ prompt: name }, "Overriding registered prompt");
  }
  store.set(name, template);
}

function getPrompt(name: string): string {
  const t = store.get(name);
  if (t === undefined) {
    throw new Error(`Prompt not registered: ${name}`);
  }
  return t;
}

/** Test helper: clear all registered prompts. */
function resetPrompts(): void {
  store.clear();
}

// Pre-register the canonical prompts.
register("system", SYSTEM_PROMPT);
register("retrieval", RETRIEVAL_PROMPT);
register("citation", CITATION_PROMPT);
register("evaluation.faithfulness", FAITHFULNESS_PROMPT);
register("evaluation.relevance", RELEVANCE_PROMPT);
register("evaluation.citation_validity", CITATION_VALIDITY_PROMPT);

export { getPrompt, registerPrompt as registerPrompt, resetPrompts };

// Local re-export with the requested name (`registerPrompt`).
function registerPrompt(name: string, template: string): void {
  register(name, template);
}
