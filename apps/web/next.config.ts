import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@rootward/shared` is a workspace package consumed from source (its
  // `tsconfig.json` path alias points at `packages/shared/src`). Next must
  // transpile it rather than expect a prebuilt `dist/` — CI runs `typecheck`
  // and `test` without a package build step.
  transpilePackages: ["@rootward/shared"],
};

export default nextConfig;
