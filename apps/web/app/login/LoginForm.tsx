"use client";

import { useId, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

const GENERIC_ERROR = "Something went wrong. Try again in a moment.";

/**
 * Magic link + Google, no passwords (decision 11). Both return through
 * `/auth/callback`. Google uses the browser client's PKCE flow. The magic
 * link does not: GoTrue mails a `token_hash` link that the server redeems
 * (SPEC §9.1), so the link opens in any browser, not only this one.
 *
 * `emailRedirectTo` still matters — it is the `{{ .RedirectTo }}` the template
 * builds its link from, which is how the visitor keeps the origin they
 * started on.
 */
export function LoginForm() {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const supabase = createSupabaseBrowserClient();
  const callbackUrl = () =>
    typeof window === "undefined"
      ? undefined
      : `${window.location.origin}/auth/callback`;

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (trimmed === "") {
      return;
    }

    setStatus({ kind: "sending" });
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: callbackUrl() },
    });
    if (error !== null) {
      setStatus({ kind: "error", message: error.message || GENERIC_ERROR });
      return;
    }
    setStatus({ kind: "sent", email: trimmed });
  }

  async function signInWithGoogle() {
    setStatus({ kind: "sending" });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    // On success the browser has already navigated to Google; only an error
    // returns control here.
    if (error !== null) {
      setStatus({ kind: "error", message: error.message || GENERIC_ERROR });
    }
  }

  if (status.kind === "sent") {
    return (
      <div
        className="border-border flex flex-col gap-2 rounded-lg border p-6"
        role="status"
      >
        <p className="text-sm font-medium">Check your email</p>
        <p className="text-muted-foreground text-sm">
          A sign-in link is on its way to {status.email}. Open it on this device
          to continue.
        </p>
      </div>
    );
  }

  const busy = status.kind === "sending";

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
        <label htmlFor={emailId} className="text-sm font-medium">
          Email
        </label>
        <Input
          id={emailId}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
          placeholder="you@example.com"
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">or</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <Button
        variant="outline"
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
      >
        Continue with Google
      </Button>

      {status.kind === "error" ? (
        <p className="text-destructive text-sm" role="alert">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
