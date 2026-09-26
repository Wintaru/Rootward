/**
 * The page a speculative fetch of `/auth/callback` gets instead of a session.
 *
 * A sign-in link is a one-time credential, so whatever fetches it spends it.
 * Declining with 204 keeps the token safe but is not enough: Safari's Top Hit
 * preload, Chrome's omnibox and speculation-rules prefetch, and Custom Tabs
 * pre-warm all hand their speculative response to the navigation the person
 * then makes. A 204 navigation is defined as "do nothing", so the person
 * presses enter and nothing happens at all — and because the URL is now in
 * history it is more likely to be preloaded again next time.
 *
 * A 200 with one ordinary link is safe in every case. Never activated, nothing
 * is spent. Activated, or reused as the navigation, the person sees a page
 * with a button that redeems the link on a click nobody can make by accident.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape for an HTML attribute. The href carries a live token from the URL. */
function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (char) => ESCAPES[char] ?? char);
}

/**
 * `href` must be the same-origin path and query the request arrived with, so
 * the click re-requests the identical link. The second request carries no
 * prefetch header, so it redeems normally.
 */
export function continueSignInHtml(href: string): string {
  const safe = escapeHtml(href);
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
a { display: inline-block; padding: 12px 24px; border-radius: 6px; background: #b54c09; color: #fffcf0; font-size: 15px; font-weight: 600; text-decoration: none; }
@media (prefers-color-scheme: dark) {
  body { background: #100f0f; color: #cecdc3; }
  main { background: #1c1b1a; border-color: #282726; }
  p { color: #878580; }
  a { background: #da702c; color: #100f0f; }
}
</style>
</head>
<body>
<main>
<h1>Continue signing in</h1>
<p>Your sign-in link works once, so we did not open it automatically. Select the button below to finish signing in.</p>
<a href="${safe}">Continue signing in</a>
</main>
</body>
</html>
`;
}
