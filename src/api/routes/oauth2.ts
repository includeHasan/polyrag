/**
 * OAuth2 routes (Google + GitHub) — route wiring only. The HTTP handling
 * (CSRF state cookies, query validation, response shaping) lives in
 * `controllers/oauth2.controller.ts` and the provider orchestration in
 * `services/oauth2.service.ts`.
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
 */
import type { FastifyInstance } from "fastify";
import { oauth2Login, oauth2Callback } from "../controllers/oauth2.controller.js";

export async function oauth2Routes(app: FastifyInstance): Promise<void> {
  // ---- /login ---------------------------------------------------------
  app.get(
    "/api/oauth2/:provider/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Begin OAuth2 login",
      },
    },
    oauth2Login,
  );

  // ---- /callback ------------------------------------------------------
  app.get(
    "/api/oauth2/:provider/callback",
    {
      schema: {
        tags: ["Auth"],
        summary: "OAuth2 callback",
      },
    },
    oauth2Callback,
  );
}
