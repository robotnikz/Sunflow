# Build Stage
FROM node:22-slim AS builder
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# Production Stage
FROM node:22-slim
WORKDIR /app

# Ensure we can reliably drop privileges at runtime.
# (Some slim images may not include a usable `su` binary by default.)
RUN apt-get update \
	&& apt-get install -y --no-install-recommends gosu \
	&& rm -rf /var/lib/apt/lists/*

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev \
	&& npm cache clean --force

# Copy built assets from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./
COPY --from=builder /app/docker/entrypoint.sh ./entrypoint.sh

# Create persistent data directory and drop root privileges
RUN mkdir -p /app/data \
	&& chown -R node:node /app

# Environment setup
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:3000/api/info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]