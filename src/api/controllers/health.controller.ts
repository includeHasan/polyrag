/**
 * Health controller — liveness/readiness. No auth, no metrics. Returns
 * immediately with the build version, current uptime, and a hard-coded
 * "ok" status. There is no domain logic here, so no service module.
 */
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

export async function health() {
  const body: HealthResponse = {
    status: "ok",
    version: VERSION,
    uptime: Math.floor((Date.now() - SERVICE_START) / 1000),
  };
  return body;
}
