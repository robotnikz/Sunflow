
<div align="center">

  <img src="public/favicon.svg" alt="SunFlow Logo" width="100" />

  # SunFlow Dashboard
  
  **The Intelligent Companion for your Fronius Gen24 Inverter.**
  
  Stop guessing. Start optimizing. Track your ROI in real-time.

  [![Docker Image Size](https://img.shields.io/docker/image-size/robotnikz/sunflow/latest?color=blue&logo=docker)](https://github.com/robotnikz/Sunflow/pkgs/container/sunflow)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![React](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-blue)](https://reactjs.org/)
  
</div>

---

## ⚡ What is SunFlow?

SunFlow is not just another monitoring tool. While manufacturer apps are great for checking if your system is running, **SunFlow is designed for the system owner who wants to maximize value.**

It combines **real-time high-speed monitoring** (direct local connection) with **financial intelligence**. SunFlow calculates exactly when your system will pay for itself based on your specific installation costs and electricity tariffs.

Most importantly, it features an **Smart Energy Assistant** that combines solar forecasts with your battery state to tell you exactly *when* to run your heavy appliances to maximize self-consumption without draining your battery for the night.

## ✨ Key Features

### 🧠 Smart Recommendations
Don't just watch the power flow—act on it.
*   **Intelligent Logic:** SunFlow analyzes your current surplus, battery charge level (SOC), and the *solar forecast* for the rest of the day.
*   **"Battery Safe" Mode:** It calculates if there is enough sun left to fill your battery *and* run your washing machine.
*   **Appliance Library:** Add your own devices (Sauna, EV, Dishwasher) with their specific power profiles to get tailored advice.

### 💰 Financial ROI Tracker
Solar is an investment. Track it like one.
*   **Amortization Countdown:** See the exact date your system breaks even.
*   **Granular Tariffs:** Supports changing energy prices over time (e.g., price hikes in 2024).
*   **CAPEX & OPEX:** Log installation costs, maintenance fees, or battery upgrades to keep your net profit calculation accurate.

### 🔮 Solar Forecasting
*   **Integrated Forecasting:** Connects with **Solcast** (High precision) or **Open-Meteo** (Fallback) to visualize future production.
*   **Planning:** The dashboard shows you at a glance if today will be a "high yield" or "conservation" day.

### 📊 Deep Historical Analysis
*   **Self-hosted Data:** Your data lives in a local SQLite database. No cloud delays, no data retention limits.
*   **Efficiency Metrics:** Track your **Autonomy** (Grid Independence) and **Self-Consumption** ratio over days, months, or years.
*   **Interactive Charts:** Zoomable, beautiful charts for Production, Load, Grid, and Battery.

---

## 📸 Screenshots

| **Live Dashboard** | **Analysis & Finances** |
|:---:|:---:|
| <img src="public/dashboard1.png" alt="Live View" width="400"/> | <img src="public/dashboard2.png" alt="History View" width="400"/> |
| *Real-time power flow & Smart Suggestions* | *ROI Tracking & Long-term History* |

---

## 🚀 Getting Started

SunFlow is built as a lightweight Docker container. You can run it on a Raspberry Pi, a Synology NAS, or any server.

### Prerequisites
1.  **Fronius Gen24 Inverter** (Symo/Primo) with `Solar API` enabled.
    *   *Enable via Inverter Web Interface: Communication > Solar API > Enable.*
2.  **Docker** installed on your machine.

### Method 1: Docker Compose (Recommended)

Create a `docker-compose.yml` file:

```yaml
version: '3.8'
services:
  sunflow:
    image: ghcr.io/robotnikz/sunflow:latest
    container_name: sunflow
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./sunflow-data:/app/data
    environment:
      - TZ=Europe/Berlin  # Set your Timezone!
```

Run it:
```bash
docker-compose up -d
```

### Method 2: Docker CLI

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/sunflow-data:/app/data \
  -e TZ=Europe/Berlin \
  --name sunflow \
  ghcr.io/robotnikz/sunflow:latest
```

---

## ⚙️ Configuration

Once running, access the dashboard at `http://localhost:3000`.

1.  Click the **Settings Icon** (top right).
2.  **General:** Enter your Inverter IP (e.g., `192.168.1.50`) and System Capacity.
3.  **Tariffs:** Add your grid costs (import) and feed-in tariffs (export). *Tip: You can add historical price changes!*
4.  **Expenses:** Add the cost of your system (Hardware + Installation) to activate the ROI widget.
5.  **Appliances:** Configure your heavy consumers to enable Smart Recommendations.

---

## 🛠 Tech Stack

*   **Frontend:** React 18, TypeScript, TailwindCSS, Recharts, Lucide Icons.
*   **Backend:** Node.js (Express), SQLite3.
*   **Architecture:** Single-container monolith for easy deployment.

## 🤝 Contributing

Contributions are welcome! Whether it's fixing a bug, adding a translation, or suggesting a new feature.

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes.
4.  Push to the branch.
5.  Open a Pull Request.

---

<div align="center">
  <sub>Built with ☀️ and ☕ by Robotnikz</sub>
</div>
