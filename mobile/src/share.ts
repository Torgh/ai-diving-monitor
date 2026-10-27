import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Hands a file to Android's share sheet (Google Drive, Gmail, Nearby Share…). In a desktop browser
 * (bun run dev:mobile) it downloads instead. Closing the share sheet without choosing is no error.
 */
export async function shareFile(name: string, text: string): Promise<void> {
  if (Capacitor.getPlatform() === "web") {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: name, files: [uri] });
  } catch (e) {
    if (!/cancel/i.test((e as Error).message)) throw e;
  }
}
