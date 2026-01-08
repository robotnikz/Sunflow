# Stage 1: Build (Erstellt das React Frontend)
FROM node:20-alpine AS builder

WORKDIR /app

# Abhängigkeiten installieren
COPY package*.json ./
RUN npm ci

# Quellcode kopieren
COPY . .

# Frontend bauen (erstellt den Ordner /dist)
RUN npm run build

# Stage 2: Production (Der eigentliche Server)
FROM node:20-alpine

WORKDIR /app

# Umgebungsvariablen setzen
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Nur Produktions-Abhängigkeiten installieren (spart Platz)
COPY package*.json ./
RUN npm ci --only=production

# Backend-Script kopieren
COPY server.js ./

# Das fertig gebaute Frontend aus Stage 1 kopieren
COPY --from=builder /app/dist ./dist

# Datenverzeichnis anlegen (für das Docker Volume)
RUN mkdir -p /app/data

# Port freigeben
EXPOSE 3000

# Startbefehl
CMD ["node", "server.js"]