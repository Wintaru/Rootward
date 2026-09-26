/**
 * The page an emailed sign-in link lands on, and the form that redeems it.
 *
 * A link works once, so whatever opens it spends it. Three attempts to tell a
 * fetcher from a person failed, the last in production: a link-preview crawler
 * took an invite seconds ahead of the visitor while sending exactly the
 * navigation headers a real browser sends, because it renders with a browser
 * engine. Nothing in a request separates the two, so a `GET` carrying a
 * `token_hash` no longer redeems at all. This page does, on its POST.
 *
 * It is a form and not a link on purpose, for two separate reasons.
 *
 * The POST is what no fetcher does. A crawler renders this page and stops:
 * nothing it does follows a form, and a link cannot be turned into one. That
 * is the whole mitigation, and it needs to recognise nobody.
 *
 * A link would also trap the clients that send no Fetch Metadata, back when
 * that was the test. Not sending those headers is a property of the client,
 * not of one request, so such a browser would loop here forever with no error
 * and no other door. Safari only added them in 16.4 and every browser on iOS
 * is WebKit, so that is an iPad a family tree gets opened on.
 *
 * Supabase documents this interstitial as one of its two sanctioned answers to
 * email prefetching; the other is mailing a code to type instead of a link.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape for an HTML attribute. The action carries a live token from the URL. */
function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (char) => ESCAPES[char] ?? char);
}

/**
 * `action` must be the same-origin path and query the request arrived with, so
 * the submission redeems the identical link.
 */
export function continueSignInHtml(action: string): string {
  const safe = escapeHtml(action);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Continue signing in · Rootward</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: #f2f0e5; color: #100f0f; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 26rem; background: #fffcf0; border: 1px solid #e6e4d9; border-radius: 10px; padding: 32px; }
h1 { margin: 0 0 12px; font-family: Georgia, "Times New Roman", serif; font-size: 22px; font-weight: 600; }
p { margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #575653; }
button { font: inherit; border: 0; cursor: pointer; padding: 12px 24px; border-radius: 6px; background: #b54c09; color: #fffcf0; font-size: 15px; font-weight: 600; }
@media (prefers-color-scheme: dark) {
  body { background: #100f0f; color: #cecdc3; }
  main { background: #1c1b1a; border-color: #282726; }
  p { color: #878580; }
  button { background: #da702c; color: #100f0f; }
}
</style>
</head>
<body>
<main>
<h1>Continue signing in</h1>
<p>Your sign-in link works only once, so we did not open it automatically. Select the button below to finish signing in.</p>
<form method="post" action="${safe}">
<button type="submit">Continue signing in</button>
</form>
</main>
</body>
</html>
`;
}
