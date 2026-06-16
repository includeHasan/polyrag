/**
 * Token counting via `tiktoken`.
 *
 * Default encoding is `cl100k_base`, which is correct for GPT-3.5/4 and
 * for `gpt-4o*` and `gpt-4o-mini*`. Encoders are cached on the encoding
 * name to avoid re-loading the BPE tables.
 */
import { encoding_for_model, get_encoding, type Tiktoken, type TiktokenEncoding } from "tiktoken";

const cache = new Map<string, Tiktoken>();

function getEncoder(model: string): Tiktoken {
  const cached = cache.get(model);
  if (cached) return cached;
  let enc: Tiktoken;
  try {
    // `encoding_for_model` only supports a small set of well-known model
    // names. Unknown models (e.g. future gpt-5) fall through to the
    // generic cl100k_base encoding, which is a good default for token
    // budgeting.
    enc = encoding_for_model(model as Parameters<typeof encoding_for_model>[0]);
  } catch {
    enc = get_encoding("cl100k_base" satisfies TiktokenEncoding);
  }
  cache.set(model, enc);
  return enc;
}

export function countTokens(text: string, model: string = "cl100k_base"): number {
  if (!text) return 0;
  const enc = getEncoder(model);
  return enc.encode(text).length;
}
