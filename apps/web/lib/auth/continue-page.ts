/**
 * The page a request gets when `/auth/callback` will not redeem the link for
 * it — see `shouldRedeem`. It carries a form, and the form's POST redeems.
 *
 * A sign-in link works once, so whatever opens it spends it. A crawler took a
 * production invite 2.6 seconds ahead of the visitor on 2026-09-26, and the
 * visitor was then told the link was invalid. So the GET does not redeem
 * unless the request proves it is a person's browser navigating.
 *
 * The form is what keeps that from locking anybody out. Not sending Fetch
 * Metadata is a property of the client, not of one request: a browser that
 * omits the headers on arrival omits them on the next click too, so a page
 * offering a plain link would loop forever with no error and no way through —
 * and Google sign-in returns to this same route, so there would be no other
 * door either. That is not a long tail. Safari shipped Fetch Metadata in 16.4,
 * every browser and in-app webview on iOS is WebKit, and an iPad stuck on
 * iPadOS 15 is exactly the device a family tree gets opened on.
 *
 * A POST is orthogonal to header support, which is why it is the escape. No
 * crawler, prefetcher, preview fetcher or link checker POSTs to a URL it found
 * in an email, and a link cannot be turned into one. So a modern browser
 * redeems on the GET with no extra click, and everything else redeems on one
 * button press.
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
