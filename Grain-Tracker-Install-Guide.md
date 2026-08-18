# Grain Tracker v2 — Complete Install Guide
### From a brand-new VPS to a running application, step by step

**Who this is for:** anyone, even if you've never touched a server before.
**Time needed:** about 30–45 minutes (most of it is waiting for installs).
**What you'll end up with:** Grain Tracker v2 running on your own server, reachable from a web browser, with automatic backups and security hardening.

---

## What you need before starting

| # | Thing | Where you get it |
|---|-------|------------------|
| 1 | A VPS running **Ubuntu 24.04** (fresh install) | Your VPS provider (Hostinger, DigitalOcean, Vultr, Hetzner…) — choose "Ubuntu 24.04" when creating it |
| 2 | The server's **IP address** (looks like `203.0.113.50`) | Shown in your VPS provider's control panel |
| 3 | The **root password** (or SSH key) | Also from your VPS provider's panel |
| 4 | **Bitvise SSH Client** or **PuTTY** on your Windows PC | Free download — google "Bitvise SSH Client download" |
| 5 | The Grain Tracker source code on GitHub | `https://github.com/kurtimas/GTv8Beta` (already public) |

> **Important:** the GitHub repo must contain the latest code. If you were given a
> file called `GTv8Beta-update.zip`, you must push it to GitHub **first** —
> see **Appendix A** at the bottom. If the repo is already up to date, skip that.

---

## PART 1 — Log into your server for the first time

1. Open **Bitvise** (or PuTTY).
2. Fill in:
   - **Host:** your server IP (e.g. `203.0.113.50`)
   - **Port:** `22`
   - **Username:** `root`
   - **Password:** the root password from your VPS provider
3. Click **Login** (Bitvise) or **Open** (PuTTY).
4. The first time, it asks if you trust the server's fingerprint — click **Yes / Accept**.
5. You now see a black terminal window with a prompt like:
   ```
   root@kbot:~#
   ```
   You're in. Everything below happens in this window unless stated otherwise.

> **Typing tips:** paste into the terminal with **right-click** (not Ctrl+V).
> Commands are case-sensitive. Press **Enter** after each one.

---

## PART 2 — Put the setup script on the server

The setup script does all the heavy lifting (about 10 automated steps). You just need to get it onto the server and edit two lines.

1. Create the file:
   ```bash
   nano gtv8-vps-setup.sh
   ```
2. A text editor opens. **Paste the entire contents** of `gtv8-vps-setup.sh`
   (from the repo / the file you were given) into the window:
   - In Bitvise's terminal: **right-click** to paste.
3. Save and exit: press **Ctrl+O**, then **Enter**, then **Ctrl+X**.

---

## PART 3 — Edit the two settings that matter

1. Open the script again:
   ```bash
   nano gtv8-vps-setup.sh
   ```
2. Scroll to the **CONFIG** block near the top (use Page Down). Find these lines:

   ```bash
   ADMIN_USER="vpsadmin"
   ADMIN_PASSWORD="weliketoparty69"     # <<< CHANGE THIS before running
   ```

3. **Change the password** to something strong that only you know:
   ```bash
   ADMIN_PASSWORD="MyOwnStrongPassword!2026"
   ```
   (This will be the password for your everyday admin account — write it down.)

4. **Optional but recommended — your domain.** If you added the DNS record
   (see Part 6 note below), set:
   ```bash
   DOMAIN="grain.kurt.wtf"
   ```
   If you don't have a domain yet, leave it as `DOMAIN=""` — you can add it later.

5. Save and exit: **Ctrl+O**, **Enter**, **Ctrl+X**.

---

## PART 4 — Run the installer

1. Make it executable and run it:
   ```bash
   chmod +x gtv8-vps-setup.sh
   ./gtv8-vps-setup.sh
   ```

2. You'll see green progress banners:
   ```
   ==> 1/10  System update + essentials
   ==> 2/10  Admin user: vpsadmin
   ==> 3/10  Hardening: UFW firewall + fail2ban + SSH
   ==> 4/10  XFCE4 desktop + XRDP
   ==> 5/10  Docker CE + Compose plugin
   ==> 6/10  Cloning GTv8Beta from GitHub
   ==> 7/10  Generating production stack (app + MySQL 8)
   ==> 8/10  Building and starting Grain Tracker
   ==> 9/10  systemd auto-start + update helper
   ==> 10/10 Nightly database backups + optional HTTPS
   ```

   **Steps 4–8 take the longest** (GUI packages + Docker build) — 10 to 20 minutes
   of scrolling text is normal. Don't close the window.

3. **⚠️ If you see this error, just wait:**
   ```
   E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process ... (unattended-upgr)
   ```
   A fresh Ubuntu server runs its own security updates at first boot and blocks
   the installer. Wait 2–5 minutes, then run `./gtv8-vps-setup.sh` again —
   the script is safe to re-run; it picks up where things left off.

4. When it finishes you'll see a big summary box:
   ```
   ================================================================================
     GRAIN TRACKER v2 — VPS SETUP COMPLETE
   ================================================================================
   ```
   **Take a photo or copy this box** — it has your IP, username, and app URL.

---

## PART 5 — Switch to your admin account (important!)

The installer **disabled root login** for security. Before closing your current
window, prove the new account works:

1. Open a **new** Bitvise/PuTTY window (keep the old one open!).
2. Log in with:
   - **Host:** same server IP
   - **Username:** `vpsadmin` (or whatever you set as `ADMIN_USER`)
   - **Password:** the password you set in Part 3
3. If you get a prompt like `vpsadmin@kbot:~$` — success. Close the root window.
4. From now on, always log in as `vpsadmin`. Commands that need admin powers
   start with `sudo` (it will ask for your password).

> **Fix permissions once** (the installer created some files as root):
> ```bash
> sudo chown -R vpsadmin:vpsadmin /opt/GTv8Beta /opt/gtv8
> git config --global --add safe.directory /opt/GTv8Beta
> ```

---

## PART 6 — Open the application

### Without a domain (quick start)

Open any browser and go to:

```
http://YOUR-SERVER-IP:3000
```

You should see the **Grain Tracker v2** dashboard (dark "operations console" look).

### With a domain (recommended — enables the USB scale from any PC)

The domain doesn't "host" anything — it's just a signpost that points browsers
at your VPS. Your existing website and email are completely untouched.

1. **At your DNS provider** (e.g. Cloudflare), add one record:

   | Type | Name | Points to | Proxy |
   |------|------|-----------|-------|
   | A | `grain` | your VPS IP | DNS only (grey cloud) |

2. **On the VPS**, set the domain and rebuild:
   ```bash
   sudo nano /opt/gtv8/.env        # add or edit:  DOMAIN=grain.kurt.wtf
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   cd /opt/gtv8 && docker compose up -d --build
   ```

3. Wait ~1 minute, then browse to **`https://grain.kurt.wtf`**.

> **Why the domain matters:** browsers only let a page talk to a USB scale
> over **HTTPS** (or localhost). With the domain, any scale-house PC running
> Chrome or Edge can use the scale. Without it, only a browser on the VPS
> desktop itself can.

---

## PART 7 — (Optional) Remote desktop GUI

The installer already set up a lightweight **XFCE4** desktop:

1. On Windows, press **Win+R**, type `mstsc`, press Enter.
2. **Computer:** your server IP → **Connect**.
3. Log in as `vpsadmin` with your password (session type: **Xorg**).
4. You get a full desktop in a window — useful for running the app in a
   browser *on the server itself* (`http://localhost:3000`), which is one way
   to use a USB scale plugged into the VPS.

---

## PART 8 — First run inside the app

Do this once, in order (in the web app):

1. **Bins** page → add your **site** (elevator/location), then add your **bins**
   with crop type and capacity.
2. **Farmers & Lots** page → add your **farmers**, then their **lots**
   (lot codes auto-suggest, e.g. `706C-JD-2601`). Attach a **landlord** +
   split % for crop-share lots.
3. **Dashboard** → open your first **weight sheet** and weigh a truck:
   - Click **Connect scale** (USB scale plugged in) or **Start simulator**
     (to practice), or type weights manually.
   - **WEIGH IN** (gross) → truck dumps → **WEIGH OUT** (tare).
   - The app computes net lbs → bushels (with moisture shrink + dockage),
     auto-assigns the least-filled bin, and updates inventory.
4. **Reports** page → end of day: review totals, then **Close day** to lock
   the day's sheets.

---

## PART 9 — Day-to-day cheat sheet

Run these on the VPS (logged in as `vpsadmin`):

| Task | Command |
|------|---------|
| See if it's running | `docker ps` |
| Live app logs | `docker logs -f grain-tracker` (Ctrl+C to stop watching) |
| Restart the app | `cd /opt/gtv8 && docker compose restart app` |
| Update to latest code from GitHub | `sudo grain-update` |
| Manual database backup | `sudo grain-backup` |
| Find backups (nightly, kept 14 days) | `ls /var/backups/grain-tracker` |
| Check auto-start service | `sudo systemctl status grain-tracker` |
| Reboot the whole server | `sudo reboot` — **the app starts itself** |

**Copy backups off the server weekly.** In Bitvise, open the **SFTP** window,
browse to `/var/backups/grain-tracker/`, and download the newest `.sql.gz` file
to your PC. If the server ever dies, that file plus this guide rebuilds everything.

---

## Troubleshooting — the errors people actually hit

| Symptom | Fix |
|---------|-----|
| `Could not get lock /var/lib/dpkg/lock-frontend` | Ubuntu is self-updating. Wait 2–5 min, re-run the script. |
| `fatal: detected dubious ownership in repository` | `git config --global --add safe.directory /opt/GTv8Beta` |
| `open /opt/gtv8/.env: permission denied` | `sudo chown -R vpsadmin:vpsadmin /opt/GTv8Beta /opt/gtv8` |
| Git asks for a password / `Invalid username or token` | The URL is wrong. Fix it: `git -C /opt/GTv8Beta remote set-url origin https://github.com/kurtimas/GTv8Beta.git` — the repo is public, pulling needs no login. |
| Build fails with `Could not load /app/src/providers/trpc` | The GitHub repo is missing the frontend files. Push the update zip first (Appendix A), then `cd /opt/GTv8Beta && git pull --ff-only` and rebuild. |
| App URL loads but "Server offline" banner shows | Database is still starting (first boot takes ~1 min). Wait and refresh. Still stuck: `docker logs grain-mysql` |
| Can't log in as root anymore | Working as intended! Use `vpsadmin`. |
| USB scale button says "Web Serial not available" | Use **Chrome or Edge**, and the page must be **HTTPS** (domain) or **localhost**. Plain `http://<ip>:3000` from another PC won't work — set up the domain (Part 6). |
| Forgot `vpsadmin` password | Log in via your VPS provider's web console as root, then `passwd vpsadmin`. |

---

## Appendix A — Push the latest code to GitHub (one-time)

*Only needed if you were handed `GTv8Beta-update.zip`.*

1. On your own PC, download and extract the zip.
2. Open a terminal and clone the repo:
   ```bash
   git clone https://github.com/kurtimas/GTv8Beta.git
   cd GTv8Beta
   ```
3. Copy the extracted `app/` folder **over** the repo's `app/` folder
   (replace/merge everything when asked).
4. Commit and push:
   ```bash
   git add -A
   git commit -m "rebuild: restore frontend + backend glue + migrations"
   git push origin main
   ```
   - GitHub no longer accepts your account password here. Use a
     **Personal Access Token** as the password: github.com → your avatar →
     **Settings → Developer settings → Personal access tokens → Tokens (classic)
     → Generate** with the `repo` scope.
5. Verify: open `https://github.com/kurtimas/GTv8Beta/tree/main/app/src/pages`
   in a browser — you should see `Dashboard.tsx`, `Sheets.tsx`, etc.

Then continue from Part 1 (or on the VPS: `sudo grain-update`).

---

## Appendix B — What got installed (for the curious)

- **Ubuntu 24.04** hardened: UFW firewall (only SSH/RDP/web ports open),
  fail2ban (blocks password-guessing bots), root SSH disabled,
  automatic security updates.
- **XFCE4 + XRDP**: lightweight remote desktop.
- **Docker CE**: runs the two containers:
  - `grain-tracker` — the app (Node 20, builds from `/opt/GTv8Beta/app`)
  - `grain-mysql` — MySQL 8 database with a persistent data volume
- **systemd service** `grain-tracker.service` — auto-starts the stack on boot.
- **`grain-update`** — one command to pull the newest code and rebuild.
- **`grain-backup`** — nightly `mysqldump` at 01:00 into
  `/var/backups/grain-tracker`, 14 days kept.
- **Caddy** (only if `DOMAIN` set) — automatic free HTTPS certificate.
