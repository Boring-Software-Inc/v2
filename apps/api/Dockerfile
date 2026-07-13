# @tripwire/api — Hono head, runs TypeScript directly on Bun (no compile step).
# Build context is the MONOREPO ROOT: `docker build -f apps/api/Dockerfile .`
# Multi-stage: resolve the workspace graph + install prod deps, then a slim
# runtime carrying only node_modules + the source it executes.

FROM oven/bun:1.3-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- install: manifests only, so this layer caches until a dependency moves ----
FROM base AS install
COPY package.json bun.lock bunfig.toml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/utils/package.json ./packages/utils/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/forge/package.json ./packages/forge/
COPY packages/forge-github/package.json ./packages/forge-github/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
# NOT --production: the @tripwire/* workspace packages are linked via root
# devDependencies, and --production drops the node_modules/@tripwire symlinks.
RUN bun install --frozen-lockfile

# ---- runtime ----
# bun links workspace deps into NESTED node_modules (apps/api/node_modules,
# packages/*/node_modules), not just the root. Copy the whole installed tree,
# then overlay real source over the manifest-only stubs (COPY merges, so the
# nested node_modules survive).
FROM base AS runtime
COPY --from=install /app ./
COPY packages ./packages
COPY apps/api ./apps/api
# API_PORT default; Railway injects PORT and the entrypoint honors it (see env).
EXPOSE 8787
CMD ["bun", "run", "apps/api/src/index.ts"]
