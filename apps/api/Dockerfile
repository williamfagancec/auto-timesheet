# Multi-stage build for Railway deployment
FROM node:20-slim AS base

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./

# Copy all package.json files for dependency resolution
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/

# Install dependencies
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source code
COPY packages ./packages
COPY apps/api ./apps/api

# Generate Prisma client
RUN cd packages/database && pnpm prisma generate

# Build packages (must be built before API)
RUN pnpm --filter config build
RUN pnpm --filter shared build
RUN pnpm --filter database build

# Build the API
RUN pnpm --filter api build

# Production image
FROM node:20-slim AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built assets and production dependencies
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /app/packages/config/node_modules ./packages/config/node_modules

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/package.json ./packages/database/
COPY --from=build /app/packages/database/prisma ./packages/database/prisma
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/config/package.json ./packages/config/

COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/

# Set working directory to API
WORKDIR /app/apps/api

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

# Start the API
CMD ["node", "dist/index.js"]
