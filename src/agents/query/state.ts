/**
 * State schema for the query agent.
 *
 * NOTE on Zod v3 / v4 interop: langgraph@1.4.x requires each StateSchema
 * field to be a `SerializableSchema` whose `~standard` extends both
 * `StandardSchemaV1.Props` and `StandardJSONSchemaV1.Props`. zod@3.25
 * satisfies the former but not the latter (no `jsonSchema` field). We
 * therefore cast the entire StateSchema constructor argument to `any`;
 * runtime is fine — `getJsonSchemaFromSchema` in langgraph tolerates a
 * missing `jsonSchema`. If the project later adopts zod@4, the cast can
 * be removed and the inferred `QueryState` types will tighten.
 */
import {
  MessagesValue,
  ReducedValue,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import {
  ChunkSchema,
  QueryUnderstandingSchema,
  SourceSchema,
} from "../../shared/types.js";

const concatReducer = <T,>(current: T[], update: T[]): T[] => [
  ...(current ?? []),
  ...(update ?? []),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const definition: any = {
  query: z.string(),
  sessionId: z.string().optional(),
  // Phase 5: identity / multi-tenancy. Threaded in by the API route so the
  // retrieve node can apply tenant filters and per-document ACLs.
  tenantId: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  tenantConfigKey: z.string().optional(),
  // Full AuthUser (shape is loose; cast to unknown to keep zod happy).
  user: z.any().optional(),
  understanding: QueryUnderstandingSchema.optional(),
  retrievedChunks: new ReducedValue(z.array(ChunkSchema) as any, {
    reducer: concatReducer<z.infer<typeof ChunkSchema>>,
    default: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any),
  rerankedChunks: z.array(ChunkSchema).default(() => []),
  context: z.string().default(() => ""),
  sources: new ReducedValue(z.array(SourceSchema) as any, {
    reducer: concatReducer<z.infer<typeof SourceSchema>>,
    default: () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any),
  draftAnswer: z.string().default(() => ""),
  finalAnswer: z.string().default(() => ""),
  groundednessScore: z.number().optional(),
  approved: z.boolean().default(() => false),
  messages: MessagesValue,
  metadata: z.record(z.string(), z.any()).default(() => ({})),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const QueryStateSchema: any = new StateSchema(definition);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QueryState = any;
