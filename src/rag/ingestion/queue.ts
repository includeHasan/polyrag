/**
 * BullMQ wiring for the ingestion pipeline.
 *
 *   const queue = getIngestQueue();
 *   await queue.add("ingest", request);
 *
 *   startIngestWorker(async (job) => runIngestion(job.data));
 *
 * The queue uses the same Redis as the embedding cache (`redisConnectionOptions`).
 * The worker is registered as a singleton so the platform can start it from
 * `server.ts` without spinning up multiple consumers.
 */
import { Queue, Worker, type Job, type Processor } from "bullmq";
import { Redis } from "ioredis";
import { env, redisConnectionOptions } from "@/core/config/env.js";
import { IngestionError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import type { IngestRequest } from "@/core/shared/types.js";

export const INGEST_QUEUE_NAME = "ingest";

// BullMQ's ConnectionOptions is a union that includes an ioredis instance.
// We declare the local alias so the rest of the file can stay readable.
type BullConnection = ConstructorParameters<typeof Queue>[1] extends infer Opt
  ? Opt extends { connection?: infer C }
    ? C
    : never
  : never;

let queueSingleton: Queue<IngestRequest, unknown, string> | undefined;
let workerSingleton: Worker<IngestRequest, unknown, string> | undefined;

function makeConnection(): BullConnection {
  // BullMQ requires `maxRetriesPerRequest: null` on the connection it uses
  // for blocking commands (the worker). The Queue and Worker can share a
  // connection in production but the worker *must* have this setting.
  return new Redis({
    ...redisConnectionOptions(),
    maxRetriesPerRequest: null,
  }) as unknown as BullConnection;
}

export function getIngestQueue(): Queue<IngestRequest, unknown, string> {
  if (queueSingleton) return queueSingleton;
  queueSingleton = new Queue<IngestRequest, unknown, string>(INGEST_QUEUE_NAME, {
    connection: makeConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  logger.info({ queue: INGEST_QUEUE_NAME }, "IngestQueue ready");
  return queueSingleton;
}

export type IngestProcessor = Processor<IngestRequest, unknown, string>;

/**
 * Wire the worker to call the supplied processor with `job.data` (an
 * `IngestRequest`). The worker logs progress and converts thrown
 * `IngestionError`s into job failures (BullMQ retries via the queue's
 * `defaultJobOptions.attempts`).
 */
export function startIngestWorker(
  processor: IngestProcessor,
): Worker<IngestRequest, unknown, string> {
  if (workerSingleton) return workerSingleton;

  const worker = new Worker<IngestRequest, unknown, string>(
    INGEST_QUEUE_NAME,
    processor,
    {
      connection: makeConnection(),
      concurrency: Number(env.CHUNK_SIZE) > 0 ? 2 : 1, // cheap heuristic
    },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "ingest job completed");
  });
  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, attempts: job?.attemptsMade, err: err?.message },
      "ingest job failed",
    );
  });
  worker.on("error", (err) => {
    logger.error({ err: err.message }, "ingest worker error");
  });

  workerSingleton = worker;
  logger.info({ queue: INGEST_QUEUE_NAME }, "IngestWorker started");
  return worker;
}

/** Test helper / graceful shutdown helper. */
export async function stopIngestWorker(): Promise<void> {
  if (workerSingleton) {
    await workerSingleton.close();
    workerSingleton = undefined;
  }
  if (queueSingleton) {
    await queueSingleton.close();
    queueSingleton = undefined;
  }
}

/** Convenience: enqueue a single ingest request. */
export async function enqueueIngest(
  request: IngestRequest,
  opts?: { jobId?: string },
): Promise<Job<IngestRequest, unknown, string>> {
  try {
    const q = getIngestQueue();
    return await q.add(
      "ingest",
      request,
      opts?.jobId ? { jobId: opts.jobId } : undefined,
    );
  } catch (err) {
    if (err instanceof IngestionError) throw err;
    throw new IngestionError(
      `failed to enqueue ingest job: ${(err as Error).message}`,
      err,
    );
  }
}
