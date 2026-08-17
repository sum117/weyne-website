# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# Weyne Representações — TanStack Start production server image.
#
# Packages the ALREADY-BUILT dist/client and dist/server output. CI keeps the
# build outside Docker because Start prerendering needs a reachable Node process.
#
# Cloudflare terminates TLS; the private Caddy sidecar proxies to this server.
# ─────────────────────────────────────────────────────────────────────────
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
LABEL org.opencontainers.image.source="https://github.com/sum117/weyne-website"
LABEL org.opencontainers.image.title="weyne-web"
LABEL org.opencontainers.image.description="Weyne Representações — TanStack Start server."

WORKDIR /app
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY dist ./dist
COPY drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/runtime.js"]
