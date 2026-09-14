import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // `@rootward/shared`, `@rootward/gedcom`, and `@rootward/media` are
  // workspace packages consumed from source (their `tsconfig.json` path
  // aliases point at `packages/*/src`). Next must transpile them rather
  // than expect a prebuilt `dist/` — CI runs `typecheck` and `test` without
  // a package build step.
  transpilePackages: [
    "@rootward/gedcom",
    "@rootward/media",
    "@rootward/shared",
  ],
  // `heic-decode` (a `@rootward/media` dependency, issue #104 pt. 2) always
  // `require`s `libheif-js`'s default Node build, whose Emscripten glue code
  // has a `require("fs")`/`require("path")` branch for reading its `.wasm`
  // file from disk -- real code Node needs, but Turbopack's static bundler
  // cannot resolve for a browser target (this import is reachable from a
  // "use client" hook via the shared `@/lib/db` barrel). Two different fixes
  // for two different sides: server code (`serverExternalPackages`) keeps
  // the package as a real `require()`, which Node resolves fine on its own;
  // the browser bundle gets redirected to a small stub
  // (`lib/import/heic-decode-browser-stub.ts`, see its own doc comment for
  // why swapping to `libheif-js`'s dependency-free build directly isn't a
  // clean option) that makes a HEIC photo processed client-side degrade to
  // "stored original, no thumbnail" -- the same already-tested fallback
  // `@rootward/media`'s pipeline gives GIF/PDF today.
  serverExternalPackages: ["heic-decode", "libheif-js"],
  turbopack: {
    resolveAlias: {
      "heic-decode": {
        browser: "./lib/import/heic-decode-browser-stub.ts",
      },
    },
  },
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
