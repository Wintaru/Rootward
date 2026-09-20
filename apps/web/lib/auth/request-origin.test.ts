import { describe, expect, it } from "vitest";

import { resolveRequestOrigin } from "./request-origin";

function headersOf(entries: Record<string, string>) {
  const lower = new Map(
    Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

describe("resolveRequestOrigin", () => {
  it("uses the Host header the visitor sent, not the server's bound origin", () => {
    expect(resolveRequestOrigin(headersOf({ host: "127.0.0.1:3000" }))).toBe(
      "http://127.0.0.1:3000",
    );
    expect(resolveRequestOrigin(headersOf({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("prefers the forwarded host and protocol behind a proxy", () => {
    expect(
      resolveRequestOrigin(
        headersOf({
          host: "10.0.0.5:3000",
          "x-forwarded-host": "family.example",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://family.example");
  });

  it("takes the first entry of a proxy chain's comma list", () => {
    expect(
      resolveRequestOrigin(
        headersOf({
          "x-forwarded-host": "family.example, edge.internal",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://family.example");
  });

  it("falls back to the caller's default protocol", () => {
    expect(
      resolveRequestOrigin(headersOf({ host: "family.example" }), {
        defaultProtocol: "https",
      }),
    ).toBe("https://family.example");
  });

  it("falls through to Host when the forwarded host is present but empty", () => {
    expect(
      resolveRequestOrigin(
        headersOf({ host: "127.0.0.1:3000", "x-forwarded-host": "" }),
      ),
    ).toBe("http://127.0.0.1:3000");
  });

  it("ignores a forwarded protocol that is not http or https", () => {
    expect(
      resolveRequestOrigin(
        headersOf({
          host: "family.example",
          "x-forwarded-proto": "javascript",
        }),
      ),
    ).toBe("http://family.example");
  });

  it("returns null with no host at all", () => {
    expect(resolveRequestOrigin(headersOf({}))).toBeNull();
    expect(resolveRequestOrigin(headersOf({ host: " " }))).toBeNull();
  });

  it("returns null for a host value that is not a host", () => {
    expect(resolveRequestOrigin(headersOf({ host: "a b" }))).toBeNull();
  });

  it("normalises to a bare origin, dropping userinfo and path", () => {
    expect(
      resolveRequestOrigin(headersOf({ host: "evil.example@real:3000" })),
    ).toBe("http://real:3000");
  });
});
