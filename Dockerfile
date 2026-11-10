# OpenCode Free Rotator - Docker Image

FROM node:18-alpine

# Install OpenCode CLI
RUN npm install -g opencode

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create directories for SQLite databases
RUN mkdir -p /root/.local/share/opencode

# Expose gateway port
EXPOSE 20130

# Expose instance ports (adjust based on your config)
EXPOSE 3001 3002 3003 3004 3005

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:20130/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start gateway
CMD ["node", "server.mjs"]
