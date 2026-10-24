import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authUrl, pkcePair } from "@/lib/server/cloudAuth";
import { assertLocal, handle } from "@/lib/server/http";

/** Starts the Google sign-in: a one-time state and PKCE verifier go into short-lived cookies. */
export const GET = handle(async (req) => {
  assertLocal(req);
  const origin = new URL(req.url).origin;
  const state = crypto.randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const res = NextResponse.redirect(authUrl({ redirectUri: `${origin}/api/auth/google/callback`, state, challenge }));
  const cookie = { httpOnly: true, sameSite: "lax" as const, path: "/api/auth/google", maxAge: 600 };
  res.cookies.set("adm_oauth_state", state, cookie);
  res.cookies.set("adm_oauth_verifier", verifier, cookie);
  return res;
});
