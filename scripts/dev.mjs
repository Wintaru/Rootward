// One-command local dev: bring up the Supabase stack, then the web app.
// Run through `pnpm dev` (which loads the repo-root `.env` first). See README.
import { spawn } from "node:child_process";

/** Run a command to completion, resolving on exit 0 and rejecting otherwise. */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

console.log("→ starting local Supabase (supabase start)…");
try {
  await run("supabase", ["start"]);
} catch {
  // `supabase start` also fails when the stack is already up — tolerate that,
  // but only if `supabase status` confirms it is actually healthy.
  try {
    await run("supabase", ["status"]);
    console.log("  Supabase is already running.");
  } catch {
    console.error(
      "\n✗ Could not start Supabase and it is not already running.\n" +
        "  Check that Docker is running and the Supabase CLI is installed.",
    );
    process.exit(1);
  }
}

console.log("→ starting the web app (next dev)…");
const web = spawn("pnpm", ["--filter", "web", "dev"], { stdio: "inherit" });
web.on("error", (error) => {
  console.error(`✗ Could not start the web app: ${error.message}`);
  process.exit(1);
});
const forward = (signal) => web.kill(signal);
process.on("SIGINT", forward);
process.on("SIGTERM", forward);
web.on("exit", (code) => {
  console.log(
    '\nWeb app stopped. The Supabase stack is still up — "pnpm dev:stop" stops it.',
  );
  process.exit(code ?? 0);
});
