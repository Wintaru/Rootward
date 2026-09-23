import { env } from "./env";

/**
 * Mailpit is the local stack's mail sink (`supabase/config.toml` →
 * `[inbucket]`). The suite drives the product's real magic-link sign-in
 * (decision 11: no passwords), so it needs to read the delivered mail back.
 *
 * API reference: https://mailpit.axllent.org/docs/api-v1/
 */

type MailpitSummary = {
  readonly ID: string;
  readonly To: readonly { readonly Address: string }[];
  readonly Created: string;
};

type MailpitMessage = {
  readonly ID: string;
  readonly Text: string;
  readonly HTML: string;
};

async function mailpit<T>(path: string): Promise<T> {
  const response = await fetch(`${env.mailpitUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Mailpit ${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Mailpit is one mailbox shared by every test in the run, so "the newest mail
 * for this address" is only unambiguous relative to a moment in time. Callers
 * take this stamp *before* triggering the mail and pass it to
 * {@link waitForMessage}; nothing is ever deleted, so two tests signing in at
 * once cannot delete each other's mail mid-flight.
 */
export function mailboxMark(): number {
  // A second of slack: Mailpit's `Created` has second resolution, and the
  // send can land in the same second as the mark.
  return Date.now() - 1000;
}

/**
 * Wait for the newest message addressed to `email` and return its body.
 * Polls because SMTP delivery is asynchronous with the HTTP response that
 * triggered it.
 */
export async function waitForMessage(
  email: string,
  {
    timeoutMs = 20_000,
    pollMs = 250,
    since,
  }: { timeoutMs?: number; pollMs?: number; since?: number } = {},
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  const target = email.toLowerCase();

  for (;;) {
    const list = await mailpit<{
      readonly messages: readonly MailpitSummary[];
    }>(`/api/v1/messages?limit=200`);
    const match = list.messages.find(
      (message) =>
        message.To.some((to) => to.Address.toLowerCase() === target) &&
        (since === undefined || Date.parse(message.Created) >= since),
    );
    if (match !== undefined) {
      return await mailpit<MailpitMessage>(`/api/v1/message/${match.ID}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `No mail for ${email} within ${timeoutMs}ms (Mailpit held ${list.messages.length} message(s)).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Pull the sign-in URL out of a GoTrue mail. Rootward's templates
 * (`supabase/templates/`) link straight to `/auth/callback?token_hash=…`, so
 * that is the shape to expect. GoTrue's own default templates link to
 * `.../auth/v1/verify?token=…` instead, and both are matched here: a hosted
 * project whose dashboard templates have not been updated yet still produces
 * a followable link, and this helper does not quietly find nothing.
 */
export function extractAuthLink(message: MailpitMessage): string {
  const source = `${message.HTML}\n${message.Text}`;
  const match = source.match(
    /https?:\/\/[^\s"'<>]*\/auth\/(?:v1\/verify|callback)\?[^\s"'<>]*/,
  );
  if (match === null) {
    throw new Error(
      `No /auth/callback or /auth/v1/verify link in the message. Body was:\n${message.Text.slice(0, 500)}`,
    );
  }
  // Mail bodies are HTML-escaped; the query separators must be unescaped
  // before the URL is followed.
  return match[0].replaceAll("&amp;", "&");
}

/** Convenience: newest mail for `email`, as a ready-to-follow auth URL. */
export async function waitForAuthLink(
  email: string,
  since?: number,
): Promise<string> {
  return extractAuthLink(await waitForMessage(email, { since }));
}
