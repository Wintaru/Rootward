import { describe, expect, it } from "vitest";

import { continueSignInHtml } from "./continue-page";

describe("continueSignInHtml", () => {
  it("links back to the address it was given", () => {
    const html = continueSignInHtml(
      "/auth/callback?token_hash=abc&type=invite",
    );
    expect(html).toContain(
      'href="/auth/callback?token_hash=abc&amp;type=invite"',
    );
  });

  it("escapes the href, which carries a live token off the URL", () => {
    const html = continueSignInHtml(
      '/auth/callback?type=invite"><script>alert(1)</script>',
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("asks a browser not to index it", () => {
    expect(continueSignInHtml("/auth/callback")).toContain(
      '<meta name="robots" content="noindex">',
    );
  });

  it("needs no script to work", () => {
    expect(continueSignInHtml("/auth/callback")).not.toContain("<script");
  });
});
