import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // `@rootward/shared` and `@rootward/gedcom` are workspace packages
  // consumed from source (their `tsconfig.json` path aliases point at
  // `packages/*/src`). Next must transpile them rather than expect a
  // prebuilt `dist/` — CI runs `typecheck` and `test` without a package
  // build step.
  transpilePackages: ["@rootward/gedcom", "@rootward/shared"],
  // Docker self-host (issue #39): a minimal `.next/standalone` server, so the
  // production image does not need the whole `node_modules` tree.
  output: "standalone",
  // Trace from the pnpm workspace root, not `apps/web` — otherwise the
  // standalone bundle misses `packages/shared`, which Next transpiles from
  // source rather than from a built `dist/`.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Dev-only: the dev server initializes on `localhost` and otherwise
  // refuses cross-origin requests for its own dev assets (JS chunks, HMR)
  // from any other hostname — including `127.0.0.1`, even though it is the
  // same machine. README.md tells people to open http://127.0.0.1:3000, so
  // without this every fresh `pnpm dev` follow-along loads a half-hydrated
  // page with no visible error beyond a console warning.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
