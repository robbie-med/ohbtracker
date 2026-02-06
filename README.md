# OB Tracker

Mobile-first OB patient tracking web app. Runs on GitHub Pages or any static file server. All data stored locally in the browser (localStorage).

## Deploy

**GitHub Pages:** Push to `main`, enable Pages in repo settings (source: root of `main` branch).

**VPS:** Serve the directory with any web server (nginx, Apache, `python3 -m http.server 8080`).

## Features

- Room-based patient cards in a 2-column mobile grid
- Mother (midnights count, EBL, C-section POD) and Baby (hours count, NICU) tracking
- Recurring alerts: mag checks (q2h), labor notes (q4h), custom intervals
- Auto-alerts: post-delivery CBC, baby 24hr checks
- Green/yellow/red status indicators
- Per-patient notes
- Dark and light themes
- Audio alert beeps when alerts fire
- All data persisted locally -- no server needed