/**
 * Liveness/readiness endpoint. No auth, no metrics. Returns immediately
 * with the build version, current uptime, and a hard-coded "ok" status.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const SERVICE_START = Date.now();
// Read at import time so the version reflects whatever is in package.json.
// Falls back to "0.0.0" if not present.
const VERSION = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__;
    return pkg ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
})();

const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  uptime: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

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
    async () => {
    const body: HealthResponse = {
      status: "ok",
      version: VERSION,
      uptime: Math.floor((Date.now() - SERVICE_START) / 1000),
    };
    return body;
  });
}
