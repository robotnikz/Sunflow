# SunFlow Dashboard for Fronius Gen24

A comprehensive monitoring solution for Fronius Gen24 inverters featuring real-time power flow, historical analysis, and financial tracking.

## Prerequisites

1. **Docker Desktop** (Windows/Mac) or Docker Engine (Linux).
2. **Fronius Gen24 Inverter** with "Solar API" enabled (Settings > Communication > Solar API).

## Installation

### Method 1: Docker Compose (Recommended)

This is the easiest way to manage the application and keep it updated.

1. Create a folder for the project (e.g., `sunflow`).
2. Download the `docker-compose.yml` from this repository and place it in that folder.
3. Open a terminal/command prompt in that folder and run:

```bash
docker-compose up -d
```

The application will start, and a `sunflow-data` folder will be created automatically to save your settings and history.

Access the dashboard at: [http://localhost:3000](http://localhost:3000)

### Method 2: Docker CLI (Quick Start)

If you just want to run it once without a compose file:

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/sunflow-data:/app/data \
  -e TZ=Europe/Berlin \
  --name sunflow \
  ghcr.io/robotnikz/sunflow:latest
```

## How to Update

When a new version is released on GitHub, you can update your local instance easily.

**If using Docker Compose:**

```bash
# 1. Pull the latest image
docker-compose pull

# 2. Restart the container with the new image
docker-compose up -d
```

## Configuration

1. Open the dashboard at [http://localhost:3000](http://localhost:3000).
2. Click the **Settings (Gear Icon)**.
3. Enter your Inverter IP (e.g., `192.168.178.50`).
4. Configure your expenses and tariffs for ROI calculation.

## Development (Building from Source)

If you want to contribute to the code or build it yourself:

1. Clone the repository.
2. Edit `docker-compose.yml` and comment out `image: ...` and uncomment `build: .`.
3. Run `docker-compose up -d --build`.
