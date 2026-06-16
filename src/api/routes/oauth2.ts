/**
 * OAuth2 routes (Google + GitHub).
 *
 *   GET /api/oauth2/:provider/login
 *     Mints a CSRF state token, stashes it in a short-lived cookie, and
 *     returns the `authorize` URL so the client can redirect the user.
 *     In dev / SPA-less mode the URL is also returned in the JSON body
 *     so curl/Postman can follow it manually.
 *
 *   GET /api/oauth2/:provider/callback?code=...&state=...
 *     Verifies the state cookie, exchanges the code for an access token,
 *     fetches the profile, upserts a `User` row, mints a JWT, and returns
 *     the token to the caller.
 *
 * Supported providers: `google`, `github`. Unknown providers → 400.
 *
 * Cookie handling: we read/write the `Set-Cookie` / `Cookie` headers via
 * the raw Node.js request/response objects so the route works without the
 * `@fastify/cookie` plugin (which isn't in `package.json`). For an
 * enterprise deployment a real cookie plugin is recommended.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PrismaClient } from "@prisma/client";
import { OAuth2Provider, type OAuthProfile } from "@/platform/security/oauth2.js";
import { signToken } from "@/platform/security/auth.js";
import { logger } from "@/core/shared/logger.js";
import {
  AuthorizationError,
  ConfigurationError,
} from "@/core/shared/errors.js";

const SUPPORTED = ["google", "github"] as const;
type SupportedProvider = (typeof SUPPORTED)[number];

const CallbackQuerySchema = z.object({
  code: z.string().min(1, "missing `code`"),
  state: z.string().min(1, "missing `state`"),
});

const STATE_COOKIE = "rag_oauth2_state";
const STATE_COOKIE_TTL_SECONDS = 10 * 60; // 10 minutes
const isProd = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Prisma client (lazy singleton)
// ---------------------------------------------------------------------------

let _prisma: PrismaClient | undefined;
function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  _prisma = new PrismaClient();
  return _prisma;
}

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

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function oauth2Routes(app: FastifyInstance): Promise<void> {
  // ---- /login ---------------------------------------------------------
  app.get("/api/oauth2/:provider/login", async (request, reply) => {
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

    const oauth = createProvider(provider);
    const url = oauth.getAuthorizationUrl(state);
    logger.info({ provider, state: state.slice(0, 8) + "…" }, "OAuth2 login initiated");

    return { provider, authorizeUrl: url, state };
  });

  // ---- /callback ------------------------------------------------------
  app.get("/api/oauth2/:provider/callback", async (request, reply) => {
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

    const oauth = createProvider(provider);
    const result = await oauth.exchangeCodeForToken(code);
    const user = await upsertUserFromProfile(result.profile, provider);
    const token = signToken({
      userId: user.id,
      roles: ["viewer"],
      email: user.email ?? undefined,
      tenantId: user.tenantId ?? undefined,
    });

    logger.info(
      { provider, userId: user.id, email: user.email },
      "OAuth2 login completed",
    );

    return {
      provider,
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        tenantId: user.tenantId,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function isSupported(s: string): s is SupportedProvider {
  return (SUPPORTED as readonly string[]).includes(s);
}

function createProvider(name: SupportedProvider): OAuth2Provider {
  try {
    return name === "google" ? OAuth2Provider.google() : OAuth2Provider.github();
  } catch (cause) {
    if (cause instanceof ConfigurationError) throw cause;
    throw new ConfigurationError(
      `OAuth2 provider '${name}' could not be created: ${(cause as Error).message}`,
      cause,
    );
  }
}

interface UpsertResult {
  id: string;
  email: string | null;
  displayName: string | null;
  tenantId: string | null;
}

async function upsertUserFromProfile(
  profile: OAuthProfile,
  provider: SupportedProvider,
): Promise<UpsertResult> {
  if (!profile.email) {
    throw new AuthorizationError(
      `OAuth2 provider '${provider}' returned a profile with no email address`,
    );
  }
  if (!profile.id) {
    throw new AuthorizationError(
      `OAuth2 provider '${provider}' returned a profile with no id`,
    );
  }

  const prisma = getPrisma();

  // Match by email — the email is the only canonical handle that works
  // across providers. The provider-specific `profile.id` is captured in
  // `metadata` for future audit / re-link.
  const existing = await prisma.user.findUnique({ where: { email: profile.email } });

  const baseData = {
    email: profile.email,
    displayName: profile.name ?? existing?.displayName ?? null,
    isActive: true,
    metadata: {
      oauth2: {
        [provider]: {
          id: profile.id,
          picture: profile.picture ?? null,
        },
      },
    },
  } as const;

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: baseData,
        select: { id: true, email: true, displayName: true, tenantId: true },
      })
    : await prisma.user.create({
        data: baseData,
        select: { id: true, email: true, displayName: true, tenantId: true },
      });

  return user;
}
