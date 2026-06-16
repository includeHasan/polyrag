/**
 * Recursive character-text chunker, the default strategy.
 *
 * Uses `RecursiveCharacterTextSplitter` from `@langchain/textsplitters`
 * with the platform's `chunkSize` and `chunkOverlap` from `chunkingConfig`.
 * No LLM calls; the splitter walks a hierarchy of separators
 * (`\n\n` -> `\n` -> ` ` -> ``) and emits roughly equal-sized chunks
 * while preserving paragraph boundaries where possible.
 */
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { BaseChunker, type BaseChunkerOptions } from "./base.js";

export class RecursiveChunker extends BaseChunker {
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(chunkSize: number, chunkOverlap: number) {
    super({ chunkSize, chunkOverlap, strategy: "recursive" });
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });
  }

  protected async splitText(text: string): Promise<string[]> {
    return this.splitter.splitText(text);
  }
}
