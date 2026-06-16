/**
 * Reindex controllers — validate the request, derive the actor, manage the
 * Human-in-the-Loop interrupt lifecycle, and delegate the actual re-index to
 * `services/reindex.service.ts`.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getObservability } from "../deps.js";
import { logger } from "@/core/shared/logger.js";
import {
  clearPendingInterrupt,
  createReindexInterrupt,
  getPendingInterrupt,
  runReindex,
} from "../services/reindex.service.js";

const ReindexRequestSchema = z.object({
  documentId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

const ResumeRequestSchema = z.object({
  /** The interrupt id returned by POST /api/reindex. */
  interruptId: z.string().min(1),
  approved: z.boolean(),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/reindex — start a reindex, pause for approval.
 */
export async function reindex(request: FastifyRequest, reply: FastifyReply) {
  const parsed = ReindexRequestSchema.safeParse(request.body);
  if (!parsed.success) throw parsed.error;

  const { documentId, reason } = parsed.data;
  const userId = request.user?.sub ?? "anonymous";
  const { interruptId } = createReindexInterrupt({
    documentId,
    reason,
    requestedBy: userId,
    requestId: request.id,
  });

  try {
    const obs = await getObservability();
    obs.incrCounter("reindexRequestsTotal");
  } catch {
    // best-effort
  }

  logger.info(
    { documentId, userId, reason, interruptId },
    "reindex request paused for human approval",
  );

  // 102 Processing (or 202 Accepted) — the work is queued pending approval.
  return reply.code(202).send({
    status: "pending_approval",
    interruptId,
    message:
      "Reindex requires human approval. POST /api/reindex/resume with { interruptId, approved } to continue.",
    proposedAction: { type: "reindex", documentId, reason },
  });
}

/**
 * POST /api/reindex/resume — caller has decided. Approve or reject.
 */
export async function reindexResume(request: FastifyRequest) {
  const parsed = ResumeRequestSchema.safeParse(request.body);
  if (!parsed.success) throw parsed.error;

  const { interruptId, approved, reason } = parsed.data;
  const interrupt = getPendingInterrupt(interruptId);
  if (!interrupt) {
    return {
      status: "unknown_interrupt",
      message: `No pending reindex for interruptId=${interruptId}. It may have been approved already.`,
    };
  }
  clearPendingInterrupt(interruptId);

  logger.info(
    { interruptId, documentId: interrupt.documentId, approved, reason },
    "reindex resume decision",
  );

  if (!approved) {
    return {
      status: "cancelled",
      interruptId,
      documentId: interrupt.documentId,
      decision: "rejected",
      reason: reason ?? "No reason provided",
    };
  }

  return runReindex(interruptId, interrupt);
}
