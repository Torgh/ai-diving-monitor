import { z } from "zod";
import { activeStorage, backendFor, oneDriveFolder } from "@/lib/server/backends";
import { googleAccount, oauthClient } from "@/lib/server/cloudAuth";
import { readSettings, updateSettings } from "@/lib/server/config";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { dataDir } from "@/lib/server/paths";
import { switchStorage } from "@/lib/server/storage";

function storageView() {
  const settings = readSettings();
  const active = activeStorage();
  return {
    active,
    chosen: settings.storage ?? "local",
    location: backendFor(active).location,
    local: { folder: dataDir() },
    onedrive: { folder: oneDriveFolder() ?? null, configuredFolder: settings.oneDriveFolder ?? null },
    google: {
      clientConfigured: !!oauthClient(),
      clientId: oauthClient()?.id ?? null,
      account: googleAccount()?.email ?? (googleAccount() ? "" : null),
    },
  };
}

export const GET = handle(async (req) => {
  assertLocal(req);
  return storageView();
});

const change = z.object({
  storage: z.enum(["local", "onedrive", "google"]).optional(),
  oneDriveFolder: z.string().max(500).nullable().optional(),
  googleClientId: z.string().max(300).nullable().optional(),
  googleClientSecret: z.string().max(300).nullable().optional(),
});

/** Saves the OneDrive folder or the Google OAuth client, and switches where the log is stored, copying it over. */
export const POST = handle(async (req) => {
  assertLocal(req);
  const body = await readBody(req, change);
  const { storage, ...rest } = body;
  if (Object.values(rest).some((v) => v !== undefined)) await updateSettings(rest);
  let copied = 0;
  if (storage) {
    if (storage === "onedrive" && !oneDriveFolder()) {
      throw new HttpError(400, "No OneDrive folder found on this PC. Install OneDrive, or enter its folder below.");
    }
    if (storage === "google" && !googleAccount()) throw new HttpError(400, "Connect Google Drive first.");
    copied = await switchStorage(storage);
  }
  return { ...storageView(), copied };
});
