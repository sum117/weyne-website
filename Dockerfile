# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# Weyne Representações — static site image.
#
# Packages the ALREADY-BUILT prerendered client (dist/client) into Caddy.
# The site is built beforehand (Node + Bun), because the TanStack Start
# prerender needs a Node server it can reach — which is unreliable inside a
# `docker build`. CI builds it in the runner, then builds this image:
# see .github/workflows/publish.yml. Locally: `bun run build` then `docker build .`.
#
# Cloudflare terminates TLS at the edge and a tunnel forwards to Caddy on :80,
# so no certificates or public ports live here.
# ─────────────────────────────────────────────────────────────────────────
FROM caddy:2-alpine
LABEL org.opencontainers.image.source="https://github.com/sum117/weyne-website"
LABEL org.opencontainers.image.title="weyne-web"
LABEL org.opencontainers.image.description="Weyne Representações — one-page marketing site (static)."

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY dist/client /srv
EXPOSE 80
