import { describe, expect, it } from "vitest";

import { continueSignInHtml } from "./continue-page";

describe("continueSignInHtml", () => {
  it("posts back to the address it was given", () => {
    const html = continueSignInHtml(
      "/auth/callback?token_hash=abc&type=invite",
    );
    expect(html).toContain(
      '<form method="post" action="/auth/callback?token_hash=abc&amp;type=invite">',
    );
    expect(html).toContain('<button type="submit">');
  });

  it("uses a form, not a link — a link cannot escape a client that omits Fetch Metadata", () => {
    const html = continueSignInHtml("/auth/callback?token_hash=abc");
    expect(html).not.toContain("<a href");
    expect(html).toContain('method="post"');
  });

  it("escapes the action, which carries a live token off the URL", () => {
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
