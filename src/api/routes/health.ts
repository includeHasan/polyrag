/**
 * Liveness/readiness endpoint — route wiring only. The status/version/uptime
 * computation lives in `controllers/health.controller.ts`. No auth, no metrics.
 */
import type { FastifyInstance } from "fastify";
import { health } from "../controllers/health.controller.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/healthz",
    {
      schema: {
        tags: ["Health"],
        summary: "Liveness & readiness probe",
        description:
          "Public liveness/readiness probe. Returns the build version, current uptime in seconds, and a hard-coded \"ok\" status. No authentication required.",
      },
    },
    health,
  );
}
