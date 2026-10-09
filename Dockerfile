# syntax=docker/dockerfile:1.7
# Alpine is the default to keep the image small. The builder uses the same musl
# family so the standalone binary matches the runtime libc.
# To use the previous Debian slim setup, replace the builder with a pinned
# `oven/bun:debian` and runtime with `debian:bookworm-slim`, then
# replace apk/user commands with apt equivalents. Verify native modules and tools.

FROM oven/bun:1.4.2-alpine AS builder

WORKDIR /build

# Dependency layer: source changes do not invalidate Bun installation.
# Do not use BuildKit cache mounts here: Railway and other builders may not
# provide cache-mount support. The image must build with a standard builder.
COPY package.json bun.lock tsconfig.json ./
COPY dashboard/package.json ./dashboard/package.json
RUN bun install --frozen-lockfile

# Copy source contracts before dashboard typecheck: dashboard mirrors several
# backend types from src/ and cannot build against dashboard alone.
COPY src ./src
COPY dashboard ./dashboard
RUN bun run dashboard:build

# Backend build layer: AOT output is required before standalone compilation.
COPY scripts ./scripts
COPY migrations ./migrations
RUN bun run build:aot && bun run build:binary --outfile /build/dist/cloviela-router

# Runtime: only the binary, dashboard assets, migrations, and entrypoint ship.
FROM alpine:3.22

WORKDIR /app

# curl powers HEALTHCHECK; util-linux provides setpriv for non-root startup.
RUN apk add --no-cache ca-certificates curl libgcc libstdc++ util-linux \
    && addgroup -S -g 10001 cloviela \
    && adduser -S -D -H -u 10001 -G cloviela cloviela \
    && mkdir -p /app/data \
    && chown -R cloviela:cloviela /app

COPY --from=builder --chown=cloviela:cloviela /build/migrations ./migrations
COPY --from=builder --chown=cloviela:cloviela /build/dist/dashboard ./dist/dashboard
COPY --chmod=755 docker-entrypoint.sh ./entrypoint.sh
COPY --from=builder --chown=cloviela:cloviela /build/dist/cloviela-router ./cloviela-router
COPY LICENSE ./LICENSE

ENV NODE_ENV=production \
    CLOVIELA_BIND_HOST=0.0.0.0 \
    DASHBOARD_DIST=/app/dist/dashboard \
    CLOVIELA_DATA_DIR=/app/data \
    CLOVIELA_INSTALL_ID_DIR=/app/data/.cloviela

EXPOSE 12800
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f "http://localhost:${PORT:-12800}/health/ready" || exit 1

# Start as root so mounted data ownership can be repaired, then drop to uid 10001.
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["./cloviela-router"]
