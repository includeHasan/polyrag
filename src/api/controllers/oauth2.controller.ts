/**
 * OAuth2 controller — HTTP layer for the Google + GitHub login flow.
 *
 * Parses the `:provider` param, mints/validates the CSRF state cookie, validates
 * the callback query, and delegates the provider exchange + user upsert + JWT
 * minting to `services/oauth2.service.ts`.
 *
 * Cookie handling: we read/write the `Set-Cookie` / `Cookie` headers via the raw
 * Node.js request/response objects so the route works without the
 * `@fastify/cookie` plugin (which isn't in `package.json`). For an enterprise
 * deployment a real cookie plugin is recommended.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "@/core/shared/logger.js";
import { AuthorizationError } from "@/core/shared/errors.js";
import {
  SUPPORTED,
  isSupported,
  getAuthorizationUrl,
  completeOAuthLogin,
  type SupportedProvider,
} from "../services/oauth2.service.js";

const CallbackQuerySchema = z.object({
  code: z.string().min(1, "missing `code`"),
  state: z.string().min(1, "missing `state`"),
});

const STATE_COOKIE = "rag_oauth2_state";
const STATE_COOKIE_TTL_SECONDS = 10 * 60; // 10 minutes
const isProd = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Cookie helpers (raw Node, no @fastify/cookie dependency)
// ---------------------------------------------------------------------------

function setStateCookie(reply: FastifyReply, value: string): void {
  const parts = [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${STATE_COOKIE_TTL_SECONDS}`,
  ];
  if (isProd) parts.push("Secure");
  const raw = reply.raw as ServerResponse;
  const existing = raw.getHeader("Set-Cookie");
  if (existing) {
    const arr = Array.isArray(existing) ? existing : [String(existing)];
    raw.setHeader("Set-Cookie", [...arr, parts.join("; ")]);
  } else {
    raw.setHeader("Set-Cookie", parts.join("; "));
  }
}

function clearStateCookie(reply: FastifyReply): void {
  const parts = [`${STATE_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isProd) parts.push("Secure");
  const raw = reply.raw as ServerResponse;
  const existing = raw.getHeader("Set-Cookie");
  if (existing) {
    const arr = Array.isArray(existing) ? existing : [String(existing)];
    raw.setHeader("Set-Cookie", [...arr, parts.join("; ")]);
  } else {
    raw.setHeader("Set-Cookie", parts.join("; "));
  }
}

function readStateCookie(request: FastifyRequest): string | undefined {
  const raw = request.raw as IncomingMessage;
  const header = raw.headers.cookie;
  if (!header) return undefined;
  for (const piece of header.split(";")) {
    const [k, ...rest] = piece.trim().split("=");
    if (k === STATE_COOKIE) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

type ProviderParseResult =
  | { ok: true; provider: SupportedProvider }
  | { ok: false; raw: string };

function parseProvider(request: FastifyRequest): ProviderParseResult {
  const raw = (request.params as { provider?: string } | undefined)?.provider ?? "";
  if (!isSupported(raw)) {
    return { ok: false, raw };
  }
  return { ok: true, provider: raw };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function oauth2Login(request: FastifyRequest, reply: FastifyReply) {
  const parsedProvider = parseProvider(request);
  if (!parsedProvider.ok) {
    return reply.code(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: `Unsupported OAuth2 provider: '${parsedProvider.raw}'`,
        details: { supported: SUPPORTED },
      },
    });
  }
  const provider = parsedProvider.provider;
  const state = randomBytes(16).toString("hex");

  setStateCookie(reply, state);

  const url = getAuthorizationUrl(provider, state);
  logger.info({ provider, state: state.slice(0, 8) + "…" }, "OAuth2 login initiated");

  return { provider, authorizeUrl: url, state };
}

export async function oauth2Callback(request: FastifyRequest, reply: FastifyReply) {
  const parsedProvider = parseProvider(request);
  if (!parsedProvider.ok) {
    return reply.code(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: `Unsupported OAuth2 provider: '${parsedProvider.raw}'`,
        details: { supported: SUPPORTED },
      },
    });
  }
  const provider = parsedProvider.provider;

  const parsed = CallbackQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    throw new AuthorizationError(
      `OAuth2 callback missing required params: ${parsed.error.issues
        .map((i) => i.path.join("."))
        .join(", ")}`,
    );
  }
  const { code, state } = parsed.data;

  const expectedState = readStateCookie(request);
  if (!expectedState || expectedState !== state) {
    clearStateCookie(reply);
    throw new AuthorizationError("OAuth2 state mismatch — possible CSRF");
  }
  // One-shot: clear the cookie regardless of the outcome below.
  clearStateCookie(reply);

  return completeOAuthLogin(provider, code);
}
