# @tripwire/web — TanStack Start head. Vite builds a self-contained nitro
# server bundle (.output); the SSR RUNTIME IS NODE, not Bun (nitro targets node).
# Build context is the MONOREPO ROOT: `docker build -f apps/web/Dockerfile .`
#
# Build-time vs runtime env. This bites hard:
#   VITE_SITE_URL, VITE_WAITLIST_OPENER_ORIGINS and VITE_SENTRY_DSN are inlined at build
#   (import.meta.env). Unkey Compute does not pass --build-arg. It mounts the
#   environment as a secret file; the build RUN sources that file.
#   https://www.unkey.com/docs/compute/build/build-secrets
#   Set them on the web app's Unkey environment. ARG defaults are
#   localhost so `docker build` with no secret still runs, and so a missing
#   Unkey variable cannot ship a production URL by accident. Railway can still
#   pass the same names as --build-arg. They are not ENV: ENV would keep the
#   value in image history, and the sourced file has to override it for one RUN.
#   Everything else the server reads (VITE_API_URL, BETTER_AUTH_*, APP_URL,
#   GITHUB_OAUTH_*, DATABASE_URL) is process.env at RUNTIME. Set it on the service.

FROM oven/bun:1.3 AS build
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
# ARG does not cross FROM. Unkey sets this to the id of the mounted env file.
ARG UNKEY_SECRETS_ID
ARG VITE_SITE_URL=http://localhost:3000
ARG VITE_WAITLIST_OPENER_ORIGINS=http://localhost:3001
ARG VITE_SENTRY_DSN=
# Build runs under Bun, but the SSR RUNTIME is Node. Force nitro's node-server
# preset so the bundle uses node http, not Bun.serve (the portability lesson).
ENV NITRO_PRESET=node-server
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY package.json bun.lock bunfig.toml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/utils/package.json ./packages/utils/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/forge/package.json ./packages/forge/
COPY packages/forge-github/package.json ./packages/forge-github/
COPY packages/forge-opengit/package.json ./packages/forge-opengit/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
COPY apps/cli/package.json ./apps/cli/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
# Packages' tsconfig.json extend ../../tsconfig.base.json; esbuild resolves it.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# `id=${UNKEY_SECRETS_ID}` is what reruns this step when an env value changes.
# required=false: a local build passes no secret, so the file is absent and the
# ARG defaults above stand. When the file is present it must name both inlined
# variables, or the build stops instead of baking localhost into a deploy.
RUN --mount=type=secret,id=${UNKEY_SECRETS_ID},target=/run/secrets/.env,required=false \
    if [ -s /run/secrets/.env ]; then \
      set -a && . /run/secrets/.env && set +a && \
      grep -q '^VITE_SITE_URL=.' /run/secrets/.env || { echo "missing VITE_SITE_URL in Unkey build secrets" >&2; exit 1; } && \
      grep -q '^VITE_WAITLIST_OPENER_ORIGINS=.' /run/secrets/.env || { echo "missing VITE_WAITLIST_OPENER_ORIGINS in Unkey build secrets" >&2; exit 1; }; \
    fi && \
    bun --filter @tripwire/web build

# ---- runtime: node serves the nitro bundle; .output is self-contained ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.output ./.output
# nitro honors PORT (Railway injects it); 3000 is the local default.
EXPOSE 3000
CMD ["node", "--import", "./.output/server/instrument.server.mjs", ".output/server/index.mjs"]
