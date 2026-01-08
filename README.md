# SunFlow Dashboard for Fronius Gen24

A comprehensive monitoring solution for Fronius Gen24 inverters featuring real-time power flow, historical analysis, and financial tracking.

## Prerequisites

1. **Docker Desktop** (Windows/Mac) or Docker Engine (Linux).
2. **Fronius Gen24 Inverter** with "Solar API" enabled (Settings > Communication > Solar API).

## Installation

### Option 1: Run via Docker Image (Easiest for Users)

Replace `YOUR_USERNAME` with the GitHub username hosting this repo.

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/sunflow-data:/app/data \
  -e TZ=Europe/Berlin \
  --name sunflow \
  ghcr.io/robotnikz/sunflow:latest
```

### Option 2: Build from Source (For Developers)

1. Clone the repository.
2. Build and run with Docker Compose:

```powershell
docker-compose up -d --build
```

Access the dashboard at [http://localhost:3000](http://localhost:3000).

## Configuration

1. Open the dashboard.
2. Click the **Settings (Gear Icon)**.
3. Enter your Inverter IP (e.g., `192.168.178.50`).
4. Configure your expenses and tariffs for ROI calculation.
