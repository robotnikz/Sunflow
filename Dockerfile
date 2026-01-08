# Stage 1: Build the React Frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package definition
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the Vite application to /app/dist
RUN npm run build

# Stage 2: Production Server
FROM node:20-alpine

WORKDIR /app

# Install build tools for native modules (like sqlite3) on Alpine
RUN apk add --no-cache python3 make g++

# Copy package definition
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the built frontend from the builder stage
COPY --from=builder /app/dist ./dist

# Copy the backend server file
COPY server.js .

# Create the data directory
RUN mkdir -p data

# Expose the application port
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]