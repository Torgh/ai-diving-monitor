import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { hostName, proxy } from "./proxy";

const request = (host: string) => new NextRequest("http://localhost:3001/", { headers: { host } });

describe("proxy", () => {
  it("answers requests addressed to this computer", () => {
    for (const host of ["localhost:3001", "127.0.0.1:3001", "[::1]:3001", "LOCALHOST"]) {
      expect(proxy(request(host)).status, host).toBe(200);
    }
  });

  it("refuses other hosts, such as a rebinding domain", () => {
    for (const host of ["evil.example:3001", "192.168.1.10:3001", "localhost.evil.example", ""]) {
      expect(proxy(request(host)).status, host).toBe(403);
    }
  });

  it("strips the port from the host", () => {
    expect(hostName("localhost:3001")).toBe("localhost");
    expect(hostName("[::1]:3001")).toBe("[::1]");
    expect(hostName("127.0.0.1")).toBe("127.0.0.1");
  });
});
