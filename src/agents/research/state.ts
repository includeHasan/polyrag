/**
 * State schema for the deep-research agent (Phase 4).
 *
 * The research agent fans out one `searcher` per sub-question via `Send`
 * and accumulates the per-searcher `Chunk` findings into a single list
 * using a `ReducedValue` reducer. The synthesizer then consumes the
 * aggregated findings and writes `finalAnswer`.
 *
 * NOTE on Zod v3 / v4 interop: see the matching note in
 * `src/agents/query/state.ts` — langgraph@1.4.x requires a
 * `SerializableSchema` that zod@3.25 doesn't fully satisfy, so the schema
 * literal is cast to `any`. Runtime is fine; type inference is loose.
 */
import {
  MessagesValue,
  ReducedValue,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import { ChunkSchema } from "../../shared/types.js";

const concatReducer = <T,>(current: T[], update: T[]): T[] => [
  ...(current ?? []),
  ...(update ?? []),
];

/**
 * Per-`Send` payload shape: when a searcher instance is launched for one
 * sub-question, the graph passes this object as the node's `state` arg.
 */
const SubQuestionSendSchema = z.object({
  query: z.string(),
  subQuestion: z.string(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const definition: any = {
  /** The original user query. */
  query: z.string(),
  /** Decomposed sub-questions to search for. */
  subQuestions: new ReducedValue(z.array(z.string()) as any, {
    reducer: (current: string[], update: string[] | undefined) => [
      ...(current ?? []),
      ...(update ?? []),
    ],
    default: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any),
  /** Per-sub-question retrieval findings (accumulated across searcher fans). */
  findings: new ReducedValue(z.array(ChunkSchema) as any, {
    reducer: concatReducer<z.infer<typeof ChunkSchema>>,
    default: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any),
  /** Working answer built up by the synthesizer. */
  draftAnswer: z.string().default(() => ""),
  /** Final answer. */
  finalAnswer: z.string().default(() => ""),
  /** True when the synthesizer has produced something publishable. */
  complete: z.boolean().default(() => false),
  /** Number of research-loop iterations (used for budget / loop control). */
  iterations: z.number().int().nonnegative().default(() => 0),
  /** Max research-loop iterations. */
  budget: z.number().int().positive().default(() => 3),
  /** Free-form per-run metadata. */
  metadata: z.record(z.string(), z.any()).default(() => ({})),
  /** Chat history (langgraph prebuilt). */
  messages: MessagesValue,
  /**
   * Sub-question passed to a single searcher instance via `Send`. Not part
   * of the global research state — declared here only because the searcher
   * node reads it from the per-task args object. Ignored by the main flow.
   */
  subQuestion: z.string().optional(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ResearchStateSchema: any = new StateSchema(definition);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResearchState = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SubQuestionSendState = z.infer<typeof SubQuestionSendSchema>;
