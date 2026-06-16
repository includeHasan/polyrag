/**
 * OAuth2 service — HTTP-agnostic provider orchestration for Google + GitHub.
 *
 * Builds authorize URLs, exchanges authorization codes for tokens, upserts the
 * `User` row from the returned profile, and mints the platform JWT. The HTTP
 * concerns (request parsing, CSRF state cookies, response shaping) live in
 * `controllers/oauth2.controller.ts`.
 */
import { PrismaClient } from "@prisma/client";
import { OAuth2Provider, type OAuthProfile } from "@/platform/security/oauth2.js";
import { signToken } from "@/platform/security/auth.js";
import { logger } from "@/core/shared/logger.js";
import {
  AuthorizationError,
  ConfigurationError,
} from "@/core/shared/errors.js";

export const SUPPORTED = ["google", "github"] as const;
export type SupportedProvider = (typeof SUPPORTED)[number];

export function isSupported(s: string): s is SupportedProvider {
  return (SUPPORTED as readonly string[]).includes(s);
}

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
// Provider orchestration
// ---------------------------------------------------------------------------

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

/** Build the provider `authorize` URL for the given CSRF state token. */
export function getAuthorizationUrl(provider: SupportedProvider, state: string): string {
  const oauth = createProvider(provider);
  return oauth.getAuthorizationUrl(state);
}

export interface OAuthLoginResult {
  provider: SupportedProvider;
  token: string;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    tenantId: string | null;
  };
}

/**
 * Exchange the authorization `code` for a token, upsert the user, and mint a
 * platform JWT.
 */
export async function completeOAuthLogin(
  provider: SupportedProvider,
  code: string,
): Promise<OAuthLoginResult> {
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
