// `pnpm dev:status` — a plain up/down summary of the local dev stack.
// Used by the Claude-managed-server rule in CLAUDE.md; safe to run any time.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WEB_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

async function webStatus() {
  try {
    const res = await fetch(WEB_URL, { signal: AbortSignal.timeout(2000) });
    return { up: true, detail: `${res.status} ${WEB_URL}` };
  } catch {
    return { up: false, detail: WEB_URL };
  }
}

async function supabaseStatus() {
  try {
    const { stdout } = await execFileAsync("supabase", [
      "status",
      "-o",
      "json",
    ]);
    const s = JSON.parse(stdout);
    return {
      up: true,
      lines: [
        ["API", s.API_URL],
        ["DB", s.DB_URL],
        ["Studio", s.STUDIO_URL],
        ["Mailpit", s.MAILPIT_URL ?? s.INBUCKET_URL],
      ].filter(([, value]) => Boolean(value)),
    };
  } catch {
    return { up: false, lines: [] };
  }
}

const [web, supabase] = await Promise.all([webStatus(), supabaseStatus()]);

console.log(`\nRootward dev status  (${process.cwd()})\n`);
console.log(`  web app     ${web.up ? "up  " : "down"}  ${web.detail}`);
console.log(
  `  Supabase    ${supabase.up ? "up" : 'down  ("pnpm dev" starts it)'}`,
);
for (const [label, value] of supabase.lines) {
  console.log(`    ${label.padEnd(8)}${value}`);
}
console.log("");

process.exitCode = web.up && supabase.up ? 0 : 1;
