import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/server/cloudAuth";
import { assertLocal } from "@/lib/server/http";
import { switchStorage } from "@/lib/server/storage";

/** Finishes the Google sign-in, stores the log on Google Drive and copies the dives there. */
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const back = (params: Record<string, string>) => {
    const res = NextResponse.redirect(`${origin}/settings?${new URLSearchParams(params)}#storage`);
    res.cookies.delete({ name: "adm_oauth_state", path: "/api/auth/google" });
    res.cookies.delete({ name: "adm_oauth_verifier", path: "/api/auth/google" });
    return res;
  };
  try {
    assertLocal(req);
    const url = new URL(req.url);
    const error = url.searchParams.get("error");
    if (error) return back({ google: "error", message: error === "access_denied" ? "Access was not granted." : (url.searchParams.get("error_description") ?? error) });
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const verifier = req.cookies.get("adm_oauth_verifier")?.value;
    if (!code || !state || !verifier || state !== req.cookies.get("adm_oauth_state")?.value) {
      return back({ google: "error", message: "The sign-in expired or was tampered with. Please try again." });
    }
    await exchangeCode({ code, verifier, redirectUri: `${origin}/api/auth/google/callback` });
    const copied = await switchStorage("google");
    return back({ google: "connected", copied: String(copied) });
  } catch (err) {
    return back({ google: "error", message: (err as Error).message });
  }
}
