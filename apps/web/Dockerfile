# Production image for the Rootward web app (issue #39, docs/deploy/docker-compose-self-host.md).
#
# Build from the repository root, not this directory — the web app is a pnpm
# workspace member and needs the sibling `packages/` sources:
#
#   docker build -f apps/web/Dockerfile -t rootward-web .
#
# `docker-compose.yml` at the repository root does this already.

FROM node:22-slim AS base
RUN corepack enable

# ---- deps: install once, cached while the lockfile is unchanged -----------
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
# apps/web does not depend on @rootward/gedcom, but a frozen-lockfile
# install checks every workspace member against the lockfile at once.
COPY packages/gedcom/package.json packages/gedcom/package.json
RUN pnpm install --frozen-lockfile

# ---- build: build every workspace package, then the standalone web app ----
FROM deps AS build
WORKDIR /repo
COPY . .
# These two are public (client-visible) values, not secrets, but `next build`
# bakes them into the browser bundle as literals (see
# apps/web/lib/supabase/env.ts) — setting them only at container *runtime*
# is too late. `docker-compose.yml` passes them as build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN pnpm build

# ---- run: only the traced standalone output, no node_modules tree ---------
FROM base AS run
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
