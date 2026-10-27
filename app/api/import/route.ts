import { ExportFileError } from "@/lib/exportFile";
import { isPhoneDives, readPhoneDives } from "@/lib/phoneDives";
import { DiveStore } from "@/lib/server/diveStore";
import { assertSameOrigin, handle, HttpError } from "@/lib/server/http";
import { UddfParseError } from "@/lib/uddf";

const MAX_BYTES = 50 * 1024 * 1024;

/** The original files in an upload: a UDDF file as it is, the file from the phone app as the ones it carries. */
function originals(name: string, data: Uint8Array): { name: string; data: Uint8Array }[] {
  if (!name.toLowerCase().endsWith(".json")) return [{ name, data }];
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new ExportFileError("This .json file isn't valid JSON.");
  }
  if (!isPhoneDives(json)) throw new ExportFileError("This isn't a file from the DiveDeck phone app. On the phone, use Your file → Send to PC.");
  return readPhoneDives(json).map((f) => ({ name: f.fileName, data: f.data }));
}

/** Uploads one or more .uddf files, or the file the phone app sends (multipart form, field "files"). */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Send the files as a multipart form.");
  });
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "No files in the upload.");
  const store = new DiveStore();
  const results = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      results.push({ file: file.name, error: "The file is larger than 50 MB." });
      continue;
    }
    let found;
    try {
      found = originals(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      if (!(err instanceof ExportFileError)) throw err;
      results.push({ file: file.name, error: err.message });
      continue;
    }
    if (!found.length) results.push({ file: file.name, error: "No dives in this file." });
    for (const { name, data } of found) {
      const label = name === file.name ? name : `${name} (from the phone)`;
      try {
        const r = await store.importFile(name, data);
        results.push({ file: label, added: r.added.length, duplicates: r.duplicates.length });
      } catch (err) {
        if (!(err instanceof UddfParseError)) throw err;
        results.push({ file: label, error: err.message });
      }
    }
  }
  return { results };
});
