# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# Weyne Representações — static site image.
#
# Build the prerendered client with Bun, then serve it from Caddy. The result
# is a tiny, stateless container: Cloudflare terminates TLS at the edge and a
# tunnel forwards to Caddy on :80, so no certificates or public ports live here.
# ─────────────────────────────────────────────────────────────────────────

# ── Build stage ──────────────────────────────────────────────────────────
# Mirror the CI environment (Node present + Bun). The TanStack Start prerender
# spins up a Node server and requests each route; a Bun-only image has no
# `node`, so nothing listens and the step fails with "Unable to connect".
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install -g bun@1.3.14

# Dependency layer — cached until package.json / bun.lock change.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Source + prerender build. The production origin and WhatsApp number have
# confirmed fallbacks in src/features/landing/content.ts; override per
# environment with --build-arg only for a preview/staging origin.
ARG VITE_SITE_ORIGIN=""
ARG VITE_WHATSAPP_NUMBER=""
ENV VITE_SITE_ORIGIN=$VITE_SITE_ORIGIN
ENV VITE_WHATSAPP_NUMBER=$VITE_WHATSAPP_NUMBER
COPY . .
# Build the prerendered client. The content/quality gate runs in CI on the
# same commit, keeping this image build focused on producing the artifact.
RUN bun run build:app

# ── Runtime stage ────────────────────────────────────────────────────────
FROM caddy:2-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/sum117/weyne-website"
LABEL org.opencontainers.image.title="weyne-web"
LABEL org.opencontainers.image.description="Weyne Representações — one-page marketing site (static)."

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/client /srv
EXPOSE 80
