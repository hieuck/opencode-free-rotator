# OpenCode Free Rotator - Docker Image
#
# Node 22 is required: better-sqlite3 (used by the diagnostic scripts) declares
# `engines.node >= 22`, and the image ships a modern Node for the gateway too.
FROM node:22-alpine

# The npm package for the OpenCode CLI is `@opencode/cli` (v2 line).
# The bare `opencode` package does NOT exist on npm and installing it fails.
# musl builds (cli-linux-x64-musl / cli-linux-arm64-musl) are selected automatically.
ARG OPENCODE_VERSION=2.2.6
RUN apk add --no-cache ca-certificates \
 && npm install -g @opencode/cli@${OPENCODE_VERSION} \
 && opencode --version

WORKDIR /app

# Install runtime dependencies first for better layer caching.
# better-sqlite3 lives in devDependencies, so no native build toolchain is needed here.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# OpenCode stores its databases and credentials here.
RUN mkdir -p /root/.local/share/opencode

ENV NODE_ENV=production

# Gateway port (instance ports are internal; adjust if you expose them).
EXPOSE 20130

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:20130/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.mjs"]
