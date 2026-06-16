/**
 * State schema for the deep-research agent (Phase 4 stub).
 *
 * NOTE on Zod v3 / v4 interop: see the matching note in
 * `src/agents/query/state.ts` — langgraph@1.4.x requires a
 * `SerializableSchema` that zod@3.25 doesn't fully satisfy, so the schema
 * literal is cast to `any`. Runtime is fine; type inference is loose.
 */
import {
  ReducedValue,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import { ChunkSchema } from "../../shared/types.js";

const concatReducer = (current: unknown[], update: unknown[]): unknown[] => {
  return [...(current ?? []), ...(update ?? [])];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const definition: any = {
  query: z.string(),
  /** Decomposed sub-questions to search for. */
  subQuestions: new ReducedValue(z.array(z.string()) as any, {
    reducer: concatReducer,
    default: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any),
  /** Per-sub-question retrieval findings. */
  findings: new ReducedValue(z.array(ChunkSchema) as any, {
    reducer: concatReducer,
    default: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any),
  /** Working answer built up by the synthesizer. */
  draftAnswer: z.string().default(() => ""),
  /** Final answer. */
  finalAnswer: z.string().default(() => ""),
  /** True when the synthesizer has produced something publishable. */
  complete: z.boolean().default(() => false),
  /** Free-form per-run metadata. */
  metadata: z.record(z.string(), z.any()).default(() => ({})),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ResearchStateSchema: any = new StateSchema(definition);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResearchState = any;
