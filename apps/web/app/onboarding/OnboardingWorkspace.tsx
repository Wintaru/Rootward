"use client";

import { type FormEvent, type ReactNode, useId, useState } from "react";

import { challengeLabel, type OnboardingIdentity } from "@/lib/db";
import type { OnboardingState } from "@/lib/onboarding/orchestrator";
import {
  type AccessRequestValues,
  type UseOnboarding,
  useOnboarding,
} from "@/lib/onboarding/useOnboarding";

/** Rough genealogy range — also keeps the value inside Postgres `smallint`. */
const MIN_BIRTH_YEAR = 1;
const MAX_BIRTH_YEAR = 2200;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function OnboardingWorkspace({
  accountId,
  allowSelfSignup,
}: {
  accountId: string;
  allowSelfSignup: boolean;
}) {
  const flow = useOnboarding(accountId, allowSelfSignup);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Join the tree</h1>
        <p className="text-muted-foreground text-sm">
          {allowSelfSignup
            ? "Find your place in the family tree, or ask an administrator for access."
            : "Ask a family administrator for access to the tree."}
        </p>
      </header>

      <OnboardingStage state={flow.state} flow={flow} />
    </main>
  );
}

function OnboardingStage({
  state,
  flow,
}: {
  state: OnboardingState;
  flow: UseOnboarding;
}) {
  switch (state.status) {
    case "identify":
      return <IdentityForm error={state.error} onSubmit={flow.search} />;
    case "searching":
      return <Waiting label="Looking for your match" />;
    // The challenge form stays mounted while its answer is checked, so a
    // verify failure returns the visitor to a form that still holds what they
    // typed.
    case "challenge":
    case "verifying":
      return (
        <ChallengeForm
          challenges={state.challenges}
          error={state.status === "challenge" ? state.error : null}
          busy={state.status === "verifying"}
          onSubmit={flow.answerChallenge}
        />
      );
    case "no_match":
      return (
        <NoMatchCard
          onRequestAccess={flow.chooseRequestAccess}
          onRestart={flow.restart}
        />
      );
    case "linked":
      return <Waiting label="You're in — taking you to the tree" />;
    case "approved_already":
      return <Waiting label="Taking you to the tree" />;
    case "request_access":
    case "requesting":
      return (
        <RequestAccessForm
          identity={state.identity}
          error={state.status === "request_access" ? state.error : null}
          busy={state.status === "requesting"}
          onRestart={state.identity === null ? undefined : flow.restart}
          onSubmit={flow.submitRequest}
        />
      );
    case "requested":
      return <RequestedCard reason={state.reason} />;
    default:
      return assertNever(state);
  }
}

// --- step 1: identity --------------------------------------------------

function IdentityForm({
  error,
  onSubmit,
}: {
  error: string | null;
  onSubmit: (identity: OnboardingIdentity) => void;
}) {
  const givenId = useId();
  const surnameId = useId();
  const yearId = useId();
  const monthId = useId();

  const [givenName, setGivenName] = useState("");
  const [surname, setSurname] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const birthYear = Number.parseInt(year, 10);
    if (
      !Number.isInteger(birthYear) ||
      birthYear < MIN_BIRTH_YEAR ||
      birthYear > MAX_BIRTH_YEAR
    ) {
      setLocalError("Enter the birth year as a number, for example 1950.");
      return;
    }
    if (givenName.trim() === "" || surname.trim() === "") {
      setLocalError("Enter both a first name and a last name.");
      return;
    }
    setLocalError(null);
    onSubmit({
      givenName: givenName.trim(),
      surname: surname.trim(),
      birthYear,
      birthMonth: month === "" ? null : Number.parseInt(month, 10),
    });
  }

  return (
    <Card
      as="form"
      onSubmit={submit}
      title="Your details"
      description="Use the name and birth date recorded in the tree — a maiden name or a nickname is fine."
    >
      <Field label="First name" htmlFor={givenId}>
        <input
          id={givenId}
          value={givenName}
          onChange={(e) => setGivenName(e.target.value)}
          autoComplete="given-name"
          className={inputClass}
        />
      </Field>
      <Field label="Last name" htmlFor={surnameId}>
        <input
          id={surnameId}
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
          autoComplete="family-name"
          className={inputClass}
        />
      </Field>
      <div className="flex gap-3">
        <Field label="Birth year" htmlFor={yearId} className="flex-1">
          <input
            id={yearId}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            inputMode="numeric"
            placeholder="1950"
            className={inputClass}
          />
        </Field>
        <Field
          label="Birth month (optional)"
          htmlFor={monthId}
          className="flex-1"
        >
          <select
            id={monthId}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {MONTHS.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <ErrorText message={localError ?? error} />
      <PrimaryButton type="submit">Find my match</PrimaryButton>
    </Card>
  );
}

// --- step 2: challenge ----------------------------------------------

function ChallengeForm({
  challenges,
  error,
  busy,
  onSubmit,
}: {
  challenges: readonly string[];
  error: string | null;
  busy: boolean;
  onSubmit: (answers: Readonly<Record<string, string>>) => void;
}) {
  const fieldId = useId();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const filled = Object.fromEntries(
      Object.entries(answers).filter(([, value]) => value.trim() !== ""),
    );
    if (Object.keys(filled).length === 0) {
      setLocalError("Answer at least one of the questions.");
      return;
    }
    setLocalError(null);
    onSubmit(filled);
  }

  return (
    <Card
      as="form"
      onSubmit={submit}
      title="One quick check"
      description="Answer what you can — one right answer is enough to link your account."
    >
      {challenges.map((key) => (
        <Field
          key={key}
          label={challengeLabel(key)}
          htmlFor={`${fieldId}-${key}`}
        >
          <input
            id={`${fieldId}-${key}`}
            value={answers[key] ?? ""}
            onChange={(e) =>
              setAnswers((prev) => ({ ...prev, [key]: e.target.value }))
            }
            inputMode={key === "birth_day" ? "numeric" : undefined}
            disabled={busy}
            className={inputClass}
          />
        </Field>
      ))}

      <ErrorText message={localError ?? error} />
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? "Checking…" : "Link my account"}
      </PrimaryButton>
    </Card>
  );
}

// --- no match --------------------------------------------------------

function NoMatchCard({
  onRequestAccess,
  onRestart,
}: {
  onRequestAccess: () => void;
  onRestart: () => void;
}) {
  return (
    <Card
      title="We couldn't match you"
      description="No node in the tree matched those details, or the answer didn't line up. You can check your details and try again, or ask an administrator to add you."
    >
      <div className="flex flex-wrap gap-3">
        <PrimaryButton type="button" onClick={onRequestAccess}>
          Request access
        </PrimaryButton>
        <SecondaryButton type="button" onClick={onRestart}>
          Try again
        </SecondaryButton>
      </div>
    </Card>
  );
}

// --- request access -------------------------------------------------

function RequestAccessForm({
  identity,
  error,
  busy,
  onRestart,
  onSubmit,
}: {
  identity: OnboardingIdentity | null;
  error: string | null;
  busy: boolean;
  onRestart?: () => void;
  onSubmit: (values: AccessRequestValues) => void;
}) {
  const nameId = useId();
  const yearId = useId();
  const messageId = useId();

  const [name, setName] = useState(
    identity === null ? "" : `${identity.givenName} ${identity.surname}`.trim(),
  );
  const [year, setYear] = useState(
    identity === null ? "" : String(identity.birthYear),
  );
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (name.trim() === "") {
      setLocalError("Enter your name so an administrator knows who is asking.");
      return;
    }
    // Optional field — an unparseable or out-of-range year is dropped, not an
    // error. `submitted_birth_year` is a Postgres smallint.
    const parsedYear = Number.parseInt(year, 10);
    const birthYear =
      Number.isInteger(parsedYear) &&
      parsedYear >= MIN_BIRTH_YEAR &&
      parsedYear <= MAX_BIRTH_YEAR
        ? parsedYear
        : null;
    setLocalError(null);
    onSubmit({
      name: name.trim(),
      birthYear,
      birthMonth: identity?.birthMonth ?? null,
      message: message.trim(),
    });
  }

  return (
    <Card
      as="form"
      onSubmit={submit}
      title="Request access"
      description="An administrator will review your request and link you to the right person."
    >
      <Field label="Your name" htmlFor={nameId}>
        <input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          disabled={busy}
          className={inputClass}
        />
      </Field>
      <Field label="Birth year (optional)" htmlFor={yearId}>
        <input
          id={yearId}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          inputMode="numeric"
          placeholder="1950"
          disabled={busy}
          className={inputClass}
        />
      </Field>
      <Field label="Message (optional)" htmlFor={messageId}>
        <textarea
          id={messageId}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="How are you related?"
          disabled={busy}
          className={inputClass}
        />
      </Field>

      <ErrorText message={localError ?? error} />
      <div className="flex flex-wrap gap-3">
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send request"}
        </PrimaryButton>
        {onRestart !== undefined && (
          <SecondaryButton type="button" onClick={onRestart} disabled={busy}>
            Back to matching
          </SecondaryButton>
        )}
      </div>
    </Card>
  );
}

function RequestedCard({ reason }: { reason: "self" | "rate_limited" }) {
  return (
    <Card
      title="Request sent"
      description={
        reason === "rate_limited"
          ? "That's a few tries now — we've passed your request to an administrator to check by hand. They'll be in touch."
          : "An administrator will review your request and get back to you. You can close this page."
      }
    />
  );
}

// --- shared pieces --------------------------------------------------

const inputClass = "border-border rounded-md border px-3 py-2 text-sm";

function Waiting({ label }: { label: string }) {
  return (
    <div
      className="border-border flex items-center gap-3 rounded-lg border p-6"
      role="status"
    >
      <span className="bg-primary h-2 w-2 animate-pulse rounded-full" />
      <span className="text-sm font-medium">{label}…</span>
    </div>
  );
}

function Card({
  as = "section",
  title,
  description,
  onSubmit,
  children,
}: {
  as?: "section" | "form";
  title: string;
  description: string;
  onSubmit?: (event: FormEvent) => void;
  children?: ReactNode;
}) {
  const className = "border-border flex flex-col gap-4 rounded-lg border p-6";
  const body = (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </>
  );
  return as === "form" ? (
    <form className={className} onSubmit={onSubmit}>
      {body}
    </form>
  ) : (
    <section className={className}>{body}</section>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p className="text-destructive text-sm" role="alert">
      {message}
    </p>
  );
}

function PrimaryButton({
  type,
  onClick,
  disabled,
  children,
}: {
  type: "submit" | "button";
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="bg-primary text-primary-foreground w-fit rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  type,
  onClick,
  disabled,
  children,
}: {
  type: "submit" | "button";
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="border-border w-fit rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled onboarding stage: ${JSON.stringify(value)}`);
}
