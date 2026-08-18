# Grain Tracker v2 — New Machine Startup Guide

This guide takes you from a brand-new computer to a running grain scale system: software install, database, scale hookup, first-run configuration, and the daily routine.

---

## 1. Before you start — two ways to run the app

| | **Option A — Hosted (recommended)** | **Option B — Self-hosted** |
|---|---|---|
| What it means | The app runs in the cloud; the scale-house machine only needs a browser | The app runs on your own machine or VPS |
| You need | Chrome or Edge on the scale PC | Node.js 20, a MySQL database, Docker (optional) |
| HTTPS for the scale | Included automatically | You must set it up yourself (see §7) |
| Data lives | Cloud database, backed up by the platform | Your own MySQL — **you** handle backups |
| Best for | Most operations | Sites with poor internet or existing IT infra |

**Option A is strongly recommended** unless you have a reason to self-host. If you choose Option A, skip to §5 (scale hookup) after publishing.

> **Note on exporting the code:** you can download the full project from the Kimi workspace, but the platform's cloud database does **not** travel with the export. A self-hosted copy needs its own MySQL database (covered below).

---

## 2. Option A — Hosted setup (5 minutes)

1. In the Kimi workspace, open the Grain Tracker v2 project and click **Publish**. You'll get a public URL like `yourname.ok.kimi.link` (you can rename the subdomain).
2. On the scale-house computer, open **Google Chrome** or **Microsoft Edge** and go to that URL. (Chrome/Edge are *required* for the USB scale — Firefox and Safari do not support the Web Serial API.)
3. First load may take 10–20 seconds while the app creates its database tables and loads the demo dataset.
4. Bookmark the page, or create a desktop shortcut: Chrome menu → *Save & share* → *Create shortcut* → check "Open as window".

You're done with software setup. Go to §5.

---

## 3. Option B — Self-hosted setup

### 3.1 What the machine needs

- **OS:** Linux (Ubuntu 22.04+ recommended), Windows 10/11, or macOS
- **RAM/CPU:** anything modest — 2 GB RAM, 2 cores is plenty
- **Software to install:**
  - **Node.js 20 LTS** — https://nodejs.org (on Ubuntu: `sudo apt install nodejs npm` or use nvm)
  - **Git** — https://git-scm.com
  - **Docker + Docker Compose** *(easiest path)* — https://docs.docker.com/get-docker/
  - If not using Docker for the database: **MySQL 8** (or a TiDB/MariaDB-compatible server)

### 3.2 Get the code

Export/download the project from the Kimi workspace, then on the new machine:

```bash
cd grain-tracker-v2   # the exported project folder
```

### 3.3 Create the database

With Docker (simplest):

```bash
docker run -d --name grain-mysql --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD=choose-a-strong-password \
  -e MYSQL_DATABASE=graintracker \
  -p 3306:3306 mysql:8
```

Or with an installed MySQL:

```sql
CREATE DATABASE graintracker CHARACTER SET utf8mb4;
CREATE USER 'grain'@'%' IDENTIFIED BY 'choose-a-strong-password';
GRANT ALL PRIVILEGES ON graintracker.* TO 'grain'@'%';
FLUSH PRIVILEGES;
```

> Tables are created automatically by the app on first boot — you only create the empty database and user.

### 3.4 Configure the environment

Create a file named `.env` in the project root:

```bash
# Required — your database
DATABASE_URL=mysql://grain:choose-a-strong-password@localhost:3306/graintracker

# Required by the app framework (not used for login in this build — any value works)
APP_ID=grain-tracker-local
APP_SECRET=any-random-string-here

# Optional — set to "false" to start with a CLEAN database (no demo farmers/sheets)
# Delete this line or set to "true" if you want the demo data for training/testing
SEED_DEMO=false
```

> If MySQL runs in Docker on the same machine and the app runs directly on the host, `localhost:3306` works. If both run in Docker, use the Compose file below and set `DATABASE_URL=mysql://grain:password@mysql:3306/graintracker`.

### 3.5 Run it — pick one

**A) With Docker (recommended):**

```bash
docker build -t grain-tracker .
docker run -d --name grain-tracker --restart unless-stopped \
  --env-file .env -p 3000:3000 grain-tracker
```

**B) With Docker Compose (app + database together):** create `docker-compose.yml`:

```yaml
services:
  mysql:
    image: mysql:8
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: choose-a-strong-password
      MYSQL_DATABASE: graintracker
      MYSQL_USER: grain
      MYSQL_PASSWORD: choose-a-strong-password
    volumes:
      - mysql-data:/var/lib/mysql
  app:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: mysql://grain:choose-a-strong-password@mysql:3306/graintracker
      APP_ID: grain-tracker-local
      APP_SECRET: any-random-string-here
      SEED_DEMO: "false"
    depends_on:
      - mysql
volumes:
  mysql-data:
```

Then: `docker compose up -d --build`

**C) Without Docker (plain Node):**

```bash
npm ci
npm run build
npm start          # serves on http://localhost:3000
```

To keep it running after logout on Linux, use systemd:

```ini
# /etc/systemd/system/grain-tracker.service
[Unit]
Description=Grain Tracker v2
After=network.target

[Service]
WorkingDirectory=/opt/grain-tracker
EnvironmentFile=/opt/grain-tracker/.env
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now grain-tracker
```

### 3.6 Verify

Open `http://localhost:3000` on the machine — you should see the Scale Dashboard. Watch the logs (`docker logs -f grain-tracker`) for:

```
[boot] database schema up to date
```

---

## 4. First-run configuration (do this once, in the app)

1. **Sites & bins** — open **Bins** in the left menu:
   - *Add site* → your elevator's name and town.
   - *Add bin* → one entry per physical bin: name, crop, capacity in lbs (bushels × lbs/bu: corn 56, wheat/soy 60, sorghum 56, barley 48).
   - If bins already contain grain, open the bin's edit (pencil icon) and set the **current level** to your measured inventory.
2. **Farmers** — **Farmers & Lots → Farmers tab** → add each producer.
3. **Landlords** — *Landlords tab* → add any crop-share landlords.
4. **Lots** — *Lots tab* → create each farmer's unique lot codes (e.g. `KMF-26-C1`), pick the crop, and — if crop-share — the landlord and their share %. Weight sheets, searches, and splits all key off these lot codes.
5. **Demo data** — if the demo dataset was loaded and you don't want it: void the demo sheets from the archive, or wipe and restart with `SEED_DEMO=false` (self-hosted: `docker compose down -v` deletes the database volume, then `up -d`).

---

## 5. Scale hardware hookup

1. Connect the scale indicator to the computer by **USB** (or USB-to-serial adapter).
2. In the app, go to the **Scale Dashboard** and click **Connect USB scale**.
3. The browser shows a device picker — select your scale/adapter and confirm.
4. The readout goes live. Put a known weight on the scale to verify.

**Indicator settings (most common):** 9600 baud, 8 data bits, no parity, 1 stop bit, continuous/ASCII output (e.g. `NT 12500 lb`). If your indicator uses a different baud rate, edit `baudRate` in `src/hooks/useScale.ts` and rebuild.

**No scale attached yet?** Click **Simulator** — a slider generates realistic fluctuating weights so staff can train, or type weights into the *manual entry* box.

---

## 6. HTTPS — required for the USB scale (self-hosted only)

Browsers only allow the Web Serial API on **HTTPS** pages or on **localhost**.

- Accessing the app as `http://localhost:3000` **on the machine physically plugged into the scale** works as-is.
- Accessing it from another machine as `http://192.168.x.x:3000` will **not** — the Connect button will say Web Serial is unavailable.

Fix it with a tiny HTTPS reverse proxy. Easiest is Caddy:

```
# Caddyfile
scale.yourdomain.com {
    reverse_proxy localhost:3000
}
```

`sudo caddy run` — Caddy gets the certificate automatically. (For LAN-only use without a domain, a self-signed cert works too; accept the browser warning once.)

---

## 7. Daily startup routine (scale-house morning)

1. Open Chrome/Edge → Grain Tracker (the Scale Dashboard).
2. Click **Connect USB scale**; verify the readout is live and reads **0** with the scale empty.
3. Check the **open weight sheets** queue — anything left from yesterday is listed first.
4. As trucks arrive: **New weight sheet** → farmer, lot, truck → then the big **WEIGH IN** / **WEIGH OUT** buttons.
5. Enter moisture/dockage/test weight on the sheet as grades come back — net bushels recalculate automatically.
6. End of day: **Daily Report** → review totals and bin levels → **Close day** to lock and archive.

---

## 8. Backups (self-hosted — your responsibility)

```bash
# Manual backup
docker exec grain-mysql mysqldump -u grain -p'password' graintracker > backup-$(date +%F).sql

# Nightly at 1 AM (crontab -e)
0 1 * * * docker exec grain-mysql mysqldump -u grain -p'password' graintracker | gzip > /backups/grain-$(date +\%F).sql.gz
```

Keep at least 7 days of backups off-machine (USB drive, NAS, or cloud sync). The weight sheets are your settlement records — treat them like checks.

## 9. Updating to a new version (self-hosted)

```bash
# with the new project export in place:
docker build -t grain-tracker . && docker compose up -d --build
# plain Node:
npm ci && npm run build && sudo systemctl restart grain-tracker
```

Database tables migrate automatically on boot — your data is preserved.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Connect USB scale" missing or error | Not Chrome/Edge, or page not on HTTPS/localhost — see §6 |
| Scale connects but reads garbage | Wrong baud rate — check indicator settings, edit `useScale.ts` |
| First load takes 20+ s | Normal — tables are being created; happens once |
| Red "cannot reach the server" banner | Database still starting (wait 30 s) or `DATABASE_URL` wrong |
| App won't start, logs mention APP_ID | `.env` missing `APP_ID`/`APP_SECRET` — see §3.4 |
| Demo farmers/sheets still there | Restart with `SEED_DEMO=false` after wiping the DB (§4.5) |
| Bin levels wrong | Edit the bin (pencil icon) → set current level to a physical measurement |
| Weights entered wrong | Open the sheet → *Correct weights* (a reason is required; it's audit-logged) |
| Need yesterday's numbers | Daily Report → pick the date |

---

## 11. Quick reference

- **App port:** 3000 · **MySQL port:** 3306
- **Logs (Docker):** `docker logs -f grain-tracker`
- **Stop/start:** `docker compose stop` / `docker compose up -d`
- **Scale browser requirement:** Chrome or Edge, HTTPS or localhost
- **Bushel weights used:** corn 56 · wheat 60 · soybeans 60 · sorghum 56 · barley 48 · oats 32 · canola 50 · sunflowers 25
- **Moisture shrink:** 1.3% per point above base moisture (corn 15.0, wheat 13.5, soy 13.0, sorghum 14.0)
