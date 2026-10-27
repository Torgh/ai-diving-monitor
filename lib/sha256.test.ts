import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Bytes, sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  it("matches the published test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches Node's crypto across block boundaries and for non-ASCII text", () => {
    for (const text of ["a".repeat(55), "a".repeat(56), "a".repeat(64), "x".repeat(1000), "Głębokość 39,2 m 🤿"]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });
});

describe("sha256Bytes", () => {
  it("matches Node's crypto for binary data", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256);
    expect(sha256Bytes(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
