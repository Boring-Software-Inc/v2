
FROM oven/bun:1.3-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS install
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
RUN bun install --frozen-lockfile

FROM base AS runtime
COPY --from=install /app ./
COPY packages ./packages
COPY apps/mcp ./apps/mcp
EXPOSE 8080
CMD ["bun", "apps/mcp/src/index.ts"]
