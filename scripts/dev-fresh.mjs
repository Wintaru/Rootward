// `pnpm dev:fresh` / `pnpm dev:up` — the whole local dev environment in a
// known-good state, as one process you start and stop. See README.
//
//   1. pnpm install --frozen-lockfile
//   2. supabase stop → supabase start        (a real restart: config.toml
//                                             changes and every container,
//                                             edge runtime included)
//   3. supabase db reset                     (dev:fresh — schema + seed as in
//                                             git; wipes local data)
//      supabase migration up                 (dev:up — new migrations only)
//   4. regenerate database.types.ts          (warns when it changed — commit it)
//   5. supabase functions serve + next dev   (side by side, prefixed logs)
//
// Ctrl-C stops both children, then the Supabase stack. If either child exits
// on its own the same teardown runs: a half-up environment is not "up".
//
// Restarting the stack drops every other local session's connection. Do not
// run this on a stack another session is using (CLAUDE.md "Servers").
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values: flags } = parseArgs({
  options: { "keep-data": { type: "boolean", default: false } },
});

const TYPES_PATH = "apps/web/lib/db/database.types.ts";
const IMPORT_MAP = "supabase/functions/deno.json";
/** A child that ignores SIGTERM this long is killed outright. */
const KILL_AFTER_MS = 10_000;

/** Run a command to completion. Resolves with its exit code; rejects only when
 * it cannot be spawned at all. */
function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    // `close`, not `exit`: the stdio pipes can still hold data at `exit`.
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

/** Print a failure and exit once stderr has flushed — `process.exit` right
 * after a write can drop the line when stdout/stderr is a pipe. */
function die(message) {
  process.stderr.write(`✗ ${message}\n`, () => process.exit(1));
  return new Promise(() => {}); // never resolves; the exit ends the script
}

/** Run a step that must succeed; exit the script when it does not.
 * `tolerateFailure` keeps going on a non-zero exit (a spawn failure still
 * exits). */
async function step(label, command, args, { tolerateFailure = false } = {}) {
  console.log(`\n→ ${label}`);
  let result;
  try {
    result = await run(command, args);
  } catch (error) {
    await die(`could not run ${command}: ${error.message}`);
  }
  if (result.code !== 0 && !tolerateFailure) {
    await die(`${label} failed (${command} exited ${result.code})`);
  }
}

// --- 1–3: dependencies, stack restart, database -------------------------

await step("installing dependencies", "pnpm", ["install", "--frozen-lockfile"]);

// Exits non-zero when nothing was running — that is fine.
await step("stopping the Supabase stack (if it is up)", "supabase", ["stop"], {
  tolerateFailure: true,
});

await step("starting the Supabase stack", "supabase", ["start"]);

if (flags["keep-data"]) {
  await step("applying new migrations", "supabase", ["migration", "up"]);
} else {
  await step("resetting the database (migrations + seed)", "supabase", [
    "db",
    "reset",
  ]);
}

// --- 4: generated types ---------------------------------------------------
// Captured rather than shell-redirected, so a failed generation cannot leave
// an empty file behind the way `supabase gen types > file` would.

console.log("\n→ regenerating database types");
const gen = await run(
  "supabase",
  ["gen", "types", "typescript", "--local", "--schema", "public"],
  { capture: true },
);
if (gen.code !== 0 || gen.stdout.trim() === "") {
  await die("type generation failed — database.types.ts left untouched");
}
const before = await readFile(TYPES_PATH, "utf8").catch(() => "");
if (before === gen.stdout) {
  console.log(`  ${TYPES_PATH} is up to date`);
} else {
  await writeFile(TYPES_PATH, gen.stdout);
  console.warn(
    `  ⚠ ${TYPES_PATH} changed — the schema and the generated types had\n` +
      "    drifted. Review the diff and commit it with the migration.",
  );
}

// --- 5: the two long-running processes -------------------------------------

console.log(
  "\n→ serving edge functions and the web app (Ctrl-C stops everything)\n",
);

/**
 * Spawn a child whose output is line-prefixed so the two logs stay readable.
 * `detached` puts the child in its own process group, for two reasons: the
 * teardown signals the whole group (`process.kill(-pid)`), so a SIGKILL sent
 * to `pnpm` also reaches the `next dev` it forked instead of orphaning it on
 * port 3000; and the terminal's Ctrl-C no longer hits the children directly,
 * so the only teardown path is the one below. The cost: closing the terminal
 * window sends no SIGHUP to the children either — use Ctrl-C.
 */
function serve(label, command, args) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const prefix = `[${label}] `;
  const forward = (stream, sink) => {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        sink.write(prefix + line + "\n");
      }
    });
    stream.on("end", () => {
      if (rest !== "") {
        sink.write(prefix + rest + "\n");
      }
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  return child;
}

const children = [
  serve("functions", "supabase", [
    "functions",
    "serve",
    "--import-map",
    IMPORT_MAP,
  ]),
  serve("web", "pnpm", ["--filter", "web", "dev"]),
];

let shuttingDown = false;

/** Signal a detached child's whole process group; a group that is already
 * gone throws ESRCH, which is the outcome wanted. */
function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

/** Stop both children, then the stack. Runs once; the exit code is set and the
 * loop is left to drain so the last lines reach a piped stdout. */
async function shutdown(reason, exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`\n→ ${reason} — stopping everything`);

  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          const force = setTimeout(
            () => signalGroup(child, "SIGKILL"),
            KILL_AFTER_MS,
          );
          child.once("close", () => {
            clearTimeout(force);
            resolve();
          });
          signalGroup(child, "SIGTERM");
        }),
    ),
  );

  const stop = await run("supabase", ["stop"]);
  if (stop.code !== 0) {
    console.error("✗ supabase stop failed — check `docker ps` for leftovers");
  }
  console.log("\nStopped. Nothing is left running.");
  process.exitCode = exitCode;
}

process.on("SIGINT", () => void shutdown("Ctrl-C", 0));
process.on("SIGTERM", () => void shutdown("terminated", 0));

for (const child of children) {
  child.on("error", (error) => {
    void shutdown(`${error.message}`, 1);
  });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      void shutdown(`a server exited (${code ?? "signal"})`, code ?? 1);
    }
  });
}
