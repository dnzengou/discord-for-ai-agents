# =============================================================================
# Dockerfile — Multi-arch Discord bot (PicoClaw / OpenClaw)
# Supports: linux/amd64 · linux/arm64 (Fly.io Arm machines, Apple Silicon)
#
# Build for ARM64:
#   docker buildx build --platform linux/arm64 -t picoclaw-bot .
#   docker buildx build --platform linux/arm64 -t openclaw-bot .
#
# Build multi-arch manifest:
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/yourorg/picoclaw-bot:latest --push .
#
# Fly.io remote build (ARM):
#   flyctl deploy --config deploy/fly.picoclaw.toml --remote-only
# =============================================================================

# syntax=docker/dockerfile:1
# ─── Stage 1: dependencies ────────────────────────────────────────────────────
# TARGETPLATFORM is injected by `docker buildx` or by fly.toml [build.args].
# node:18-slim has native arm64 layers — no emulation needed on Fly Arm machines.
ARG TARGETPLATFORM=linux/amd64
ARG TARGETARCH=amd64
ARG NODE_VERSION=18

FROM --platform=${TARGETPLATFORM} node:${NODE_VERSION}-slim AS deps

WORKDIR /app

# Copy only manifests first — maximises Docker layer cache hit rate.
COPY package.json package-lock.json* ./

# Install production deps only (no devDependencies in the final image).
# `npm ci` is deterministic and honours package-lock.json exactly.
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# ─── Stage 2: build (TypeScript → JavaScript) ─────────────────────────────────
FROM --platform=${TARGETPLATFORM} node:${NODE_VERSION}-slim AS builder

WORKDIR /app

# Install ALL deps (including TypeScript) for the build step.
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source — layered after deps to avoid cache bust on every source change.
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript.
RUN npm run build

# ─── Stage 3: production image ────────────────────────────────────────────────
FROM --platform=${TARGETPLATFORM} node:${NODE_VERSION}-slim AS runner

# Metadata
LABEL org.opencontainers.image.title="Clow Bot"
LABEL org.opencontainers.image.description="PicoClaw / OpenClaw Discord AI bot"
LABEL org.opencontainers.image.source="https://github.com/dnzengou/discord-for-ai-agents"
LABEL org.opencontainers.image.architecture="${TARGETARCH}"

# Security: run as non-root user.
# node:slim ships with a `node` user (UID 1000).
RUN mkdir -p /app && chown node:node /app
USER node
WORKDIR /app

# ARM64-specific: Node.js 18 includes native arm64 crypto/async bindings.
# No additional native module compilation needed for @discordjs/rest.
ENV NODE_ENV=production
ENV PORT=3000

# Production node_modules from the deps stage.
COPY --from=deps   --chown=node:node /app/node_modules ./node_modules

# Compiled JavaScript from the builder stage.
COPY --from=builder --chown=node:node /app/dist ./dist

# Health-check — Discord requires your interactions endpoint to respond fast.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT+'/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

EXPOSE ${PORT}

# Use exec form (not shell form) so SIGINT/SIGTERM reach the Node process
# directly — Fly.io sends SIGINT on deploy, and the bot should drain gracefully.
CMD ["node", "dist/server.js"]
