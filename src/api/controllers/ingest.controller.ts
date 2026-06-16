/**
 * Ingest controller — validates the request, enforces auth/permission/tenant,
 * delegates to the ingest service, and records metrics.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import { IngestRequestSchema } from "@/core/shared/types.js";
import { AuthorizationError } from "@/core/shared/errors.js";
import { requirePermission } from "@/platform/security/rbac.js";
import { getObservability } from "../deps.js";
import { ingestDocument } from "../services/ingest.service.js";
import { identity } from "./_context.js";

export async function ingest(request: FastifyRequest, reply: FastifyReply) {
  const start = Date.now();

  const { user, tenantId } = identity(request);
  if (!user) {
    throw new AuthorizationError("Authentication required to ingest");
  }
  requirePermission(user, "ingest");

  const parsed = IngestRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  const body = await ingestDocument({ ...parsed.data, tenantId: tenantId ?? "default" });

  const obs = await getObservability();
  obs.incrCounter("ingestionsTotal");
  obs.recordLatency("ingest", Date.now() - start);
  reply.header("x-request-id", request.id);
  return body;
}
