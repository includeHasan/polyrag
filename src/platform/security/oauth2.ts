/**
 * OAuth2 provider implementations for Google and GitHub.
 *
 * Each provider knows its authorize + token endpoints and how to map the
 * provider's profile shape to our `OAuthProfile` interface. State tokens
 * (CSRF) and short-lived secrets are the caller's responsibility.
 *
 * Usage:
 *   const google = OAuth2Provider.google();
 *   const url = google.getAuthorizationUrl(state, ["openid", "email", "profile"]);
 *   ...
 *   const { accessToken, profile } =
 *     await google.exchangeCodeForToken(code, redirectUri);
 *
 * If the matching `OAUTH2_*_CLIENT_ID` env var is missing, the constructor
 * throws a `ConfigurationError` so misconfiguration is caught at boot
 * rather than at the first user sign-in.
 */
import { ConfigurationError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";

/** Normalised profile returned by every provider's `fetchProfile`. */
export interface OAuthProfile {
  /** Provider-specific stable id (Google `sub`, GitHub `id`). */
  id: string;
  /** Email address — preferred primary key for matching against `User.email`. */
  email: string;
  /** Display name / full name. */
  name?: string;
  /** Optional avatar URL. */
  picture?: string;
}

/** Result of exchanging an authorization code for an access token. */
export interface OAuthTokenResult {
  accessToken: string;
  /** May be undefined if the provider doesn't issue one. */
  refreshToken?: string;
  /** Absolute expiry timestamp (ms since epoch), or undefined if unknown. */
  expiresAt?: Date;
  /** The provider's normalised profile for this user. */
  profile: OAuthProfile;
}

interface OAuthProviderConfig {
  name: "google" | "github";
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  /** Maps the raw provider profile to our `OAuthProfile`. */
  mapProfile: (raw: Record<string, unknown>) => OAuthProfile;
  /** Default scopes requested if the caller doesn't pass any. */
  defaultScopes: string[];
  /** Whether the provider accepts Basic auth for the token endpoint. */
  usesBasicAuth: boolean;
}

const GOOGLE_CONFIG: OAuthProviderConfig = {
  name: "google",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  profileUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
  defaultScopes: ["openid", "email", "profile"],
  usesBasicAuth: true,
  mapProfile: (raw) => ({
    id: String(raw.sub ?? raw.id ?? ""),
    email: String(raw.email ?? ""),
    name: typeof raw.name === "string" ? raw.name : undefined,
    picture: typeof raw.picture === "string" ? raw.picture : undefined,
  }),
};

const GITHUB_CONFIG: OAuthProviderConfig = {
  name: "github",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  profileUrl: "https://api.github.com/user",
  defaultScopes: ["read:user", "user:email"],
  usesBasicAuth: false,
  // GitHub's /user endpoint doesn't always include the primary email — when
  // it does not, the caller may need to follow up with /user/emails. For
  // Phase 5 we keep the contract simple: if `email` is missing we return
  // an empty string and the route handler decides what to do.
  mapProfile: (raw) => ({
    id: String(raw.id ?? ""),
    email: String(raw.email ?? ""),
    name: typeof raw.name === "string" ? raw.name : undefined,
    picture: typeof raw.avatar_url === "string" ? raw.avatar_url : undefined,
  }),
};

// ---------------------------------------------------------------------------
// Env-var helpers
// ---------------------------------------------------------------------------

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/** Default redirect URI used when callers don't supply one explicitly. */
function defaultRedirectUri(): string {
  return (
    readEnv("OAUTH2_REDIRECT_URI") ??
    "http://localhost:3000/api/oauth2/callback"
  );
}

// ---------------------------------------------------------------------------
// OAuth2Provider
// ---------------------------------------------------------------------------

/**
 * Provider-specific OAuth2 client. Construct via `OAuth2Provider.google()`
 * or `OAuth2Provider.github()`. Direct construction is allowed but
 * discouraged.
 */
export class OAuth2Provider {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  private constructor(
    private readonly config: OAuthProviderConfig,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  /** Construct a Google provider. */
  static google(opts?: { redirectUri?: string }): OAuth2Provider {
    const clientId = readEnv("OAUTH2_GOOGLE_CLIENT_ID");
    const clientSecret = readEnv("OAUTH2_GOOGLE_CLIENT_SECRET");
    if (!clientId) {
      throw new ConfigurationError(
        "OAUTH2_GOOGLE_CLIENT_ID is not set — Google sign-in is not configured",
      );
    }
    if (!clientSecret) {
      throw new ConfigurationError(
        "OAUTH2_GOOGLE_CLIENT_SECRET is not set — Google sign-in is not configured",
      );
    }
    return new OAuth2Provider(
      GOOGLE_CONFIG,
      clientId,
      clientSecret,
      opts?.redirectUri ?? defaultRedirectUri(),
    );
  }

  /** Construct a GitHub provider. */
  static github(opts?: { redirectUri?: string }): OAuth2Provider {
    const clientId = readEnv("OAUTH2_GITHUB_CLIENT_ID");
    const clientSecret = readEnv("OAUTH2_GITHUB_CLIENT_SECRET");
    if (!clientId) {
      throw new ConfigurationError(
        "OAUTH2_GITHUB_CLIENT_ID is not set — GitHub sign-in is not configured",
      );
    }
    if (!clientSecret) {
      throw new ConfigurationError(
        "OAUTH2_GITHUB_CLIENT_SECRET is not set — GitHub sign-in is not configured",
      );
    }
    return new OAuth2Provider(
      GITHUB_CONFIG,
      clientId,
      clientSecret,
      opts?.redirectUri ?? defaultRedirectUri(),
    );
  }

  /** Provider name. */
  get name(): "google" | "github" {
    return this.config.name;
  }

  /** Configured redirect URI. */
  get redirectUriValue(): string {
    return this.redirectUri;
  }

  /**
   * Build the `authorize` URL the browser should redirect the user to.
   *
   * @param state  an opaque CSRF token the caller will verify on callback
   * @param scopes space-separated scopes to request (defaults from config)
   */
  getAuthorizationUrl(state: string, scopes?: string[]): string {
    const finalScopes = scopes && scopes.length > 0 ? scopes : this.config.defaultScopes;
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: finalScopes.join(" "),
      state,
    });
    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Exchange an authorization `code` for an access token + profile.
   *
   * @throws `ConfigurationError` on misconfiguration
   * @throws `RagError` on provider errors
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri?: string,
  ): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri ?? this.redirectUri,
      grant_type: "authorization_code",
    });

    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    if (this.config.usesBasicAuth) {
      const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
      headers.authorization = `Basic ${basic}`;
    }

    let res: Response;
    try {
      res = await fetch(this.config.tokenUrl, {
        method: "POST",
        headers,
        body: body.toString(),
      });
    } catch (cause) {
      throw new ConfigurationError(
        `OAuth2(${this.config.name}) token endpoint unreachable: ${(cause as Error).message}`,
        cause,
      );
    }

    const raw = (await safeJson(res)) as Record<string, unknown>;
    if (!res.ok || raw.error) {
      const desc = String(raw.error_description ?? raw.error ?? `HTTP ${res.status}`);
      throw new ConfigurationError(
        `OAuth2(${this.config.name}) token exchange failed: ${desc}`,
      );
    }

    const accessToken = String(raw.access_token ?? "");
    if (!accessToken) {
      throw new ConfigurationError(
        `OAuth2(${this.config.name}) token response missing access_token`,
      );
    }

    const refreshToken =
      typeof raw.refresh_token === "string" ? raw.refresh_token : undefined;

    let expiresAt: Date | undefined;
    if (typeof raw.expires_in === "number") {
      expiresAt = new Date(Date.now() + raw.expires_in * 1000);
    }

    const profile = await this.fetchProfile(accessToken);

    return { accessToken, refreshToken, expiresAt, profile };
  }

  /**
   * Fetch the user's profile using a previously-obtained access token.
   */
  async fetchProfile(accessToken: string): Promise<OAuthProfile> {
    let res: Response;
    try {
      res = await fetch(this.config.profileUrl, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
          "user-agent": "advanced-rag-platform",
        },
      });
    } catch (cause) {
      throw new ConfigurationError(
        `OAuth2(${this.config.name}) profile endpoint unreachable: ${(cause as Error).message}`,
        cause,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ConfigurationError(
        `OAuth2(${this.config.name}) profile fetch failed: HTTP ${res.status} ${text}`,
      );
    }
    const raw = (await safeJson(res)) as Record<string, unknown>;
    const profile = this.config.mapProfile(raw);
    if (!profile.id) {
      logger.warn({ provider: this.config.name, raw }, "OAuth2 profile missing id");
    }
    if (!profile.email) {
      logger.warn({ provider: this.config.name }, "OAuth2 profile missing email");
    }
    return profile;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}
