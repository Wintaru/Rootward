import type { NextConfig } from "next";
import path from "node:path";

const SECURITY_HEADERS: { key: string; value: string }[] = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

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
  //
  // Off whenever `VERCEL` is set. Vercel builds through its own
  // output-file-tracing adapter, and Next 16.3 skips writing
  // `.next/next-server.js.nft.json` when an adapter and standalone output
  // are both active -- the adapter then dies in `onBuildComplete` looking
  // for that file (vercel/next.js#96646; hit here on 16.3.3, 2026-09-22).
  // It is also correct independently of the bug: Vercel never serves the
  // standalone bundle, so building one there is pure waste.
  //
  // `NEXT_ADAPTER_PATH` is the exact trigger -- it is what turns the
  // adapter on -- but `VERCEL` is deliberately used instead. It is a
  // documented system variable set on every Vercel build (production,
  // preview and development), whereas the other is an undocumented
  // internal that could be renamed or bypassed, and this guard can only
  // ever be tested by a real cloud deploy. The cost of the looser signal
  // is that a local `vercel build` also skips `.next/standalone`, which
  // nothing consumes. A plain `next build` or `pnpm build` is unaffected
  // and still writes `.next/standalone` for the Docker image.
  output: process.env.VERCEL ? undefined : "standalone",
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
  // Security headers on every response (#132), set here so both deploy
  // paths get them -- Vercel sets a bare HSTS and none of the rest, the
  // self-host Caddyfile sets nothing. HSTS is a no-op over plain HTTP, so a
  // LAN self-host without TLS is unaffected. The CSP deliberately has no
  // `script-src` / `style-src`: the theme pre-paint script in `layout.tsx`
  // is inline and Next's own chunks would need per-request nonces through
  // middleware -- a 1.x item. What is here still closes clickjacking
  // (`frame-ancestors`), plugin content, base-tag hijack, and off-site
  // form posts.
  headers() {
    return Promise.resolve([
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ]);
  },
};

export default nextConfig;
