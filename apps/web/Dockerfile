# @tripwire/web — TanStack Start head. Vite builds a self-contained nitro
# server bundle (.output); the SSR RUNTIME IS NODE, not Bun (nitro targets node).
# Build context is the MONOREPO ROOT: `docker build -f apps/web/Dockerfile .`
#
# Build-time vs runtime env — this bites hard:
#   VITE_SITE_URL is INLINED at build (import.meta.env, seo.ts). It MUST be the
#   real public web URL at build time or canonical/OG tags point at localhost.
#   Everything else the server reads (VITE_API_URL, BETTER_AUTH_*, APP_URL,
#   GITHUB_OAUTH_*, DATABASE_URL) is process.env at RUNTIME — set on the service.

FROM oven/bun:1.3 AS build
WORKDIR /app
ARG VITE_SITE_URL=http://localhost:3000
ENV VITE_SITE_URL=$VITE_SITE_URL
ARG VITE_WAITLIST_OPENER_ORIGINS=""
ENV VITE_WAITLIST_OPENER_ORIGINS=$VITE_WAITLIST_OPENER_ORIGINS
# Build runs under Bun, but the SSR RUNTIME is Node — force nitro's node-server
# preset so the bundle uses node http, not Bun.serve (the portability lesson).
ENV NITRO_PRESET=node-server
COPY package.json bun.lock bunfig.toml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/utils/package.json ./packages/utils/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/forge/package.json ./packages/forge/
COPY packages/forge-github/package.json ./packages/forge-github/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
RUN bun install --frozen-lockfile
# Packages' tsconfig.json extend ../../tsconfig.base.json; esbuild resolves it.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN bun --filter @tripwire/web build

# ---- runtime: node serves the nitro bundle; .output is self-contained ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.output ./.output
# nitro honors PORT (Railway injects it); 3000 is the local default.
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
