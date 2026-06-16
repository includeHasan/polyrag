/**
 * OpenAPI / Swagger documentation.
 *
 * Registers `@fastify/swagger` (which builds the OpenAPI 3 spec by hooking
 * `onRoute`) and `@fastify/swagger-ui` (the interactive viewer). Because
 * the spec is built from routes registered *after* this plugin, callers MUST
 * register swagger BEFORE `registerRoutes` — see `createServer()`.
 *
 *   - Spec (JSON):  GET /docs/json
 *   - Swagger UI:   GET /docs
 *
 * A single `bearerAuth` security scheme is declared; individual routes opt in
 * via `schema.security` so the UI shows the lock icon and an "Authorize"
 * button that injects `Authorization: Bearer <jwt>`.
 */
import type { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { env } from "@/core/config/env.js";

/** Path prefixes that serve the docs themselves (used to skip auth/tenant hooks). */
export const DOCS_PATH_PREFIXES = ["/docs"] as const;

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Advanced RAG Platform API",
        description:
          "Multi-tenant, domain-agnostic Retrieval-Augmented Generation platform. " +
          "All `/api/*` routes require a Bearer JWT carrying `userId`, `roles`, and " +
          "(for tenant-scoped routes) `tenantId`. Use the **Authorize** button to set it.",
        version: "0.1.0",
      },
      servers: [
        { url: `http://localhost:${env.SERVER_PORT}`, description: "Local" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "HS256 JWT signed with the platform `JWT_SECRET`.",
          },
        },
      },
      tags: [
        { name: "Health", description: "Liveness, readiness, and metrics." },
        { name: "Query", description: "RAG query and raw retrieval." },
        { name: "Ingestion", description: "Document ingestion and re-indexing." },
        { name: "Feedback & Eval", description: "User feedback and evaluation harness." },
        { name: "Sessions", description: "Conversation session history and state." },
        { name: "Billing", description: "Per-tenant usage and quota." },
        { name: "Auth", description: "OAuth2 login and callback." },
        { name: "Admin", description: "Platform-admin tenant provisioning and config." },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });
}
