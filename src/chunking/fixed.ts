/**
 * Token-based fixed chunker. Uses `tiktoken` with the `cl100k_base` encoding
 * (the same encoding used by `text-embedding-3-*` models) so that `chunkSize`
 * and `chunkOverlap` are measured in tokens, not characters.
 */
import { get_encoding, type Tiktoken } from "tiktoken";
import { BaseChunker, type BaseChunkerOptions } from "./base.js";

let cachedEncoder: Tiktoken | undefined;

function getEncoder(): Tiktoken {
  if (!cachedEncoder) cachedEncoder = get_encoding("cl100k_base");
  return cachedEncoder;
}

export class FixedChunker extends BaseChunker {
  constructor(chunkSize: number, chunkOverlap: number) {
    super({ chunkSize, chunkOverlap, strategy: "fixed" });
  }

  protected async splitText(text: string): Promise<string[]> {
    const enc = getEncoder();
    const tokens = enc.encode(text);
    if (tokens.length <= this.chunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    const stride = Math.max(1, this.chunkSize - this.chunkOverlap);
    for (let start = 0; start < tokens.length; start += stride) {
      const end = Math.min(start + this.chunkSize, tokens.length);
      const slice = tokens.slice(start, end);
      chunks.push(new TextDecoder().decode(enc.decode(slice)));
      if (end === tokens.length) break;
    }
    return chunks;
  }
}
