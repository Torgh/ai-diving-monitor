import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readSettings } from "./config";
import { readJson, writeFileAtomic } from "./files";
import { HttpError } from "./http";
import { dataDir } from "./paths";

/**
 * Signing in to Google Drive (OAuth with PKCE), as in TripDeck. The app asks only for `drive.file`:
 * the files it created itself (its DiveDeck folder), never the diver's other files. The
 * refresh token stays in the data folder on this computer.
 */
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = ["openid", "email", GOOGLE_DRIVE_FILE_SCOPE];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface StoredToken {
  refreshToken: string;
  accessToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  email?: string;
  scope?: string;
}

const tokenFile = () => path.join(dataDir(), "google-token.json");

const readToken = () => {
  try {
    return JSON.parse(fs.readFileSync(tokenFile(), "utf8")) as StoredToken;
  } catch {
    return undefined;
  }
};

/** The OAuth client from Settings, or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. */
export function oauthClient(): { id: string; secret: string } | undefined {
  const s = readSettings();
  const id = process.env.GOOGLE_CLIENT_ID?.trim() || s.googleClientId;
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim() || s.googleClientSecret;
  return id && secret ? { id, secret } : undefined;
}

/** The connected Google account, if any. */
export function googleAccount(): { email?: string } | undefined {
  const token = readToken();
  return token?.refreshToken ? { email: token.email } : undefined;
}

export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authUrl(opts: { redirectUri: string; state: string; challenge: string }): string {
  const client = oauthClient();
  if (!client) throw new HttpError(400, "Add your Google OAuth client in Settings first.");
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const client = oauthClient();
  if (!client) throw new HttpError(503, "The Google OAuth client is missing from Settings.");
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: client.id, client_secret: client.secret }),
    });
  } catch {
    throw new HttpError(503, "Google sign-in is unreachable. Are you online?");
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || data.error) {
    const message = data.error_description?.split("\r\n")[0] ?? data.error ?? "Google sign-in failed.";
    throw new HttpError(res.status === 400 || res.status === 401 ? 401 : 502, message);
  }
  return data;
}

/** The id_token comes straight from Google over TLS, so its payload can be read without verifying. */
function emailFromIdToken(idToken?: string): string | undefined {
  try {
    return (JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8")) as { email?: string }).email;
  } catch {
    return undefined;
  }
}

export async function exchangeCode(opts: { code: string; verifier: string; redirectUri: string }): Promise<string | undefined> {
  const data = await tokenRequest({ code: opts.code, redirect_uri: opts.redirectUri, grant_type: "authorization_code", code_verifier: opts.verifier });
  if (!data.refresh_token) throw new HttpError(502, "Google did not return a refresh token. Try connecting again.");
  if (!data.scope?.split(" ").includes(GOOGLE_DRIVE_FILE_SCOPE)) {
    throw new HttpError(403, "Google Drive access was not granted. Connect again and allow access to the files this app creates.");
  }
  const token: StoredToken = {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: emailFromIdToken(data.id_token),
    scope: data.scope,
  };
  await writeFileAtomic(tokenFile(), JSON.stringify(token, null, 2));
  return token.email;
}

/** A valid access token, refreshed when needed; undefined when Google isn't connected. */
export async function accessToken(): Promise<string | undefined> {
  const token = readToken();
  if (!token?.refreshToken) return undefined;
  if (token.accessToken && token.expiresAt && token.expiresAt - 60_000 > Date.now()) return token.accessToken;
  try {
    const data = await tokenRequest({ refresh_token: token.refreshToken, grant_type: "refresh_token" });
    const next: StoredToken = {
      ...token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope ?? token.scope,
    };
    await writeFileAtomic(tokenFile(), JSON.stringify(next, null, 2));
    return data.access_token;
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw new HttpError(401, "Google Drive access expired or was revoked. Reconnect it in Settings.");
    }
    throw err;
  }
}

/** Signs out: revokes the token at Google and forgets it here. */
export async function disconnect(): Promise<void> {
  const token = await readJson<StoredToken>(tokenFile());
  if (token?.refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.refreshToken)}`, { method: "POST" }).catch(() => undefined);
  }
  fs.rmSync(tokenFile(), { force: true });
}
