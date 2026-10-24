import { DiveStore } from "@/lib/server/diveStore";
import { assertSameOrigin, handle, HttpError } from "@/lib/server/http";
import { UddfParseError } from "@/lib/uddf";

const MAX_BYTES = 50 * 1024 * 1024;

/** Uploads one or more .uddf files (multipart form, field "files"). */
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
    try {
      const r = await store.importFile(file.name, new Uint8Array(await file.arrayBuffer()));
      results.push({ file: file.name, added: r.added.length, duplicates: r.duplicates.length });
    } catch (err) {
      if (!(err instanceof UddfParseError)) throw err;
      results.push({ file: file.name, error: err.message });
    }
  }
  return { results };
});
