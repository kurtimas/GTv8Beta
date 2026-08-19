#!/usr/bin/env bash
#===============================================================================
#  GTv8Beta — Grain Tracker v2  |  One-shot VPS setup for fresh Ubuntu 24.04
#
#  Repo : https://github.com/kurtimas/GTv8Beta  (public)
#  Stack: Node 20 · Vite/React frontend · Hono/tRPC API · Drizzle ORM · MySQL 8
#  App  : serves on port 3000, runs DB migrations automatically on boot
#
#  What this script does:
#    1.  System update + essential tools
#    2.  Admin user (sudo + docker) with your password
#    3.  Hardening: UFW firewall, fail2ban, root SSH login disabled,
#        automatic security updates
#    4.  XFCE4 lightweight desktop + XRDP remote desktop server
#    5.  Docker CE + Compose plugin (official Docker repo)
#    6.  Clones GTv8Beta from GitHub -> /opt/GTv8Beta
#    7.  Generates a production docker-compose stack (app + MySQL 8 with
#        persistent volume + healthcheck) in /opt/gtv8  + random secrets
#    8.  Builds and starts everything; systemd auto-start on reboot
#    9.  Nightly encrypted-location MySQL backups (/var/backups/grain-tracker)
#   10.  Optional: Caddy HTTPS reverse proxy if you set DOMAIN (needed for
#        the USB scale / Web Serial when accessing from another computer)
#
#  Usage — on the VPS, logged in as root:
#      nano gtv8-vps-setup.sh            # review the CONFIG block (password!)
#      chmod +x gtv8-vps-setup.sh
#      ./gtv8-vps-setup.sh
#
#  After it finishes:
#    SSH  : Bitvise / PuTTY  -> <server-ip>:22   user: see ADMIN_USER below
#    GUI  : Windows mstsc    -> <server-ip>:3389 (XFCE4 session)
#    App  : https://<DOMAIN>           (if DOMAIN set)
#           http://<server-ip>:3000    (otherwise)
#
#  USB SCALE NOTE: browsers only allow Web Serial on HTTPS or localhost.
#    - Scale plugged into the VPS itself (via GUI): use http://localhost:3000
#    - Scale plugged into a scale-house PC: set DOMAIN below so you get HTTPS,
#      or SSH-tunnel port 3000 to that PC's localhost.
#===============================================================================

set -euo pipefail
IFS=$'\n\t'

#===============================================================================
#  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>  CONFIG  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
#===============================================================================

# ---- App / repo --------------------------------------------------------------
GIT_REPO_URL="https://github.com/kurtimas/GTv8Beta.git"
GIT_BRANCH=""                        # empty = auto-detect default branch
REPO_DIR="/opt/GTv8Beta"             # git clone location
DEPLOY_DIR="/opt/gtv8"               # compose stack + .env + backups config
SEED_DEMO="false"                    # "true" loads demo farmers/sheets (training)

# ---- Domain / HTTPS (optional but recommended for the USB scale) -------------
DOMAIN=""                            # e.g. scale.yourfarm.com  -> Caddy HTTPS
                                     # Point the DNS A record at the VPS FIRST.
                                     # Empty = plain http://<ip>:3000

# ---- Admin user --------------------------------------------------------------
ADMIN_USER="vpsadmin"
ADMIN_PASSWORD="weliketoparty69"     # <<< CHANGE THIS before running

# ---- GUI ---------------------------------------------------------------------
INSTALL_GUI=true                     # XFCE4 + XRDP
INSTALL_BROWSER=true                 # Chromium inside the desktop (via snap)
RDP_VIA_TUNNEL=false                 # true = RDP only reachable via SSH tunnel

# ---- SSH hardening -----------------------------------------------------------
SSH_PORT=22
DISABLE_ROOT_SSH=true
DISABLE_PASSWORD_SSH=false           # set true ONLY after your SSH key works!

# ---- Misc --------------------------------------------------------------------
TIMEZONE="UTC"                       # e.g. "America/Chicago"
BACKUP_RETENTION_DAYS=14

#===============================================================================
#  <<<<<<<<<<<<<<<<<<<<<<<<<<  END OF CONFIG  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
#===============================================================================

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[error] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo -i, then ./gtv8-vps-setup.sh"
[[ "$ADMIN_PASSWORD" != "ChangeMe!Str0ng" ]] || \
    warn "You left ADMIN_PASSWORD at the default — change it after install: passwd $ADMIN_USER"

#-------------------------------------------------------------------------------
log "1/10  System update + essentials"
#-------------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg lsb-release \
    git unzip zip tar jq htop net-tools openssl \
    software-properties-common apt-transport-https \
    ufw fail2ban unattended-upgrades nano vim

timedatectl set-timezone "$TIMEZONE" || warn "Timezone '$TIMEZONE' not applied"

# Automatic security updates
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

#-------------------------------------------------------------------------------
log "2/10  Admin user: $ADMIN_USER"
#-------------------------------------------------------------------------------
if ! id "$ADMIN_USER" &>/dev/null; then
    adduser --disabled-password --gecos "" "$ADMIN_USER"
    echo "${ADMIN_USER}:${ADMIN_PASSWORD}" | chpasswd
    usermod -aG sudo "$ADMIN_USER"
fi
# Reuse root's authorized_keys for the admin user if present (first boot on
# many VPS images installs your key for root only).
if [[ -s /root/.ssh/authorized_keys && ! -s /home/$ADMIN_USER/.ssh/authorized_keys ]]; then
    mkdir -p /home/$ADMIN_USER/.ssh
    cp /root/.ssh/authorized_keys /home/$ADMIN_USER/.ssh/authorized_keys
    chown -R $ADMIN_USER:$ADMIN_USER /home/$ADMIN_USER/.ssh
    chmod 700 /home/$ADMIN_USER/.ssh
    chmod 600 /home/$ADMIN_USER/.ssh/authorized_keys
    log "Copied your SSH key from root to $ADMIN_USER."
fi

#-------------------------------------------------------------------------------
log "3/10  Hardening: UFW firewall + fail2ban + SSH"
#-------------------------------------------------------------------------------
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp comment 'SSH'
if [[ "$INSTALL_GUI" == true && "$RDP_VIA_TUNNEL" == false ]]; then
    ufw allow 3389/tcp comment 'RDP (XFCE4)'
fi
if [[ -n "$DOMAIN" ]]; then
    ufw allow 80/tcp  comment 'HTTP  (Caddy)'
    ufw allow 443/tcp comment 'HTTPS (Caddy)'
else
    ufw allow 3000/tcp comment 'Grain Tracker app'
fi
ufw --force enable

cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = $SSH_PORT
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-gtv8-hardening.conf <<EOF
Port $SSH_PORT
PermitRootLogin $( [[ "$DISABLE_ROOT_SSH" == true ]] && echo "no" || echo "prohibit-password" )
PasswordAuthentication $( [[ "$DISABLE_PASSWORD_SSH" == true ]] && echo "no" || echo "yes" )
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding yes
EOF
sshd -t && systemctl restart ssh
warn "Root SSH login is now disabled. Use '$ADMIN_USER' from now on —"
warn "open a NEW Bitvise/PuTTY session as $ADMIN_USER BEFORE closing this one."

#-------------------------------------------------------------------------------
if [[ "$INSTALL_GUI" == true ]]; then
log "4/10  XFCE4 desktop + XRDP"
#-------------------------------------------------------------------------------
    apt-get install -y --no-install-recommends \
        xorg xfce4 xfce4-terminal xfce4-goodies dbus-x11 \
        xrdp xorgxrdp

    echo "startxfce4" > /home/$ADMIN_USER/.xsession
    chown $ADMIN_USER:$ADMIN_USER /home/$ADMIN_USER/.xsession

    # Silence the colord "authentication required" popups over RDP
    mkdir -p /etc/polkit-1/localauthority/50-local.d
    cat > /etc/polkit-1/localauthority/50-local.d/45-allow-colord.pkla <<'EOF'
[Allow Colord all Users]
Identity=unix-user:*
Action=org.freedesktop.color-manager.create-device;org.freedesktop.color-manager.create-profile;org.freedesktop.color-manager.delete-device;org.freedesktop.color-manager.delete-profile;org.freedesktop.color-manager.modify-device;org.freedesktop.color-manager.modify-profile
ResultAny=no
ResultInactive=no
ResultActive=yes
EOF

    adduser xrdp ssl-cert >/dev/null 2>&1 || true
    systemctl enable --now xrdp
    systemctl restart xrdp

    if [[ "$INSTALL_BROWSER" == true ]]; then
        # On Ubuntu 24.04, chromium/firefox debs are snap-transitional.
        if snap install chromium 2>/dev/null; then
            log "Chromium installed (snap)."
        else
            warn "Snap not available on this VPS — skipping browser."
            warn "The desktop still works; install a browser later if needed."
        fi
    fi
else
    log "4/10  GUI skipped"
fi

#-------------------------------------------------------------------------------
log "5/10  Docker CE + Compose plugin"
#-------------------------------------------------------------------------------
if ! command -v docker &>/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker "$ADMIN_USER" || true

#-------------------------------------------------------------------------------
log "6/10  Cloning GTv8Beta from GitHub"
#-------------------------------------------------------------------------------
# Auto-detect default branch unless one was pinned in CONFIG
if [[ -z "$GIT_BRANCH" ]]; then
    GIT_BRANCH=$(git ls-remote --symref "$GIT_REPO_URL" HEAD \
        | awk '/^ref:/ {sub("refs\/heads\/", "", $2); print $2}')
    GIT_BRANCH=${GIT_BRANCH:-main}
fi
log "Using branch: $GIT_BRANCH"

if [[ -d "$REPO_DIR/.git" ]]; then
    git -C "$REPO_DIR" fetch --all
    git -C "$REPO_DIR" checkout "$GIT_BRANCH"
    git -C "$REPO_DIR" pull --ff-only origin "$GIT_BRANCH"
else
    git clone --branch "$GIT_BRANCH" --single-branch "$GIT_REPO_URL" "$REPO_DIR"
fi

[[ -f "$REPO_DIR/app/Dockerfile" ]] || die "No Dockerfile at $REPO_DIR/app — repo layout changed?"

#-------------------------------------------------------------------------------
log "7/10  Generating production stack (app + MySQL 8) in $DEPLOY_DIR"
#-------------------------------------------------------------------------------
mkdir -p "$DEPLOY_DIR"

# Generate secrets ONCE — on re-runs we keep the existing .env so the
# database password stays in sync with the data volume.
if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
    MYSQL_ROOT_PW=$(openssl rand -hex 24)
    MYSQL_PW=$(openssl rand -hex 24)
    APP_SECRET=$(openssl rand -hex 32)
    cat > "$DEPLOY_DIR/.env" <<EOF
# Generated by gtv8-vps-setup.sh on $(date -u +%F) — keep this file secret!
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PW
MYSQL_DATABASE=graintracker
MYSQL_USER=grain
MYSQL_PASSWORD=$MYSQL_PW
DATABASE_URL=mysql://grain:$MYSQL_PW@mysql:3306/graintracker
APP_ID=grain-tracker-local
APP_SECRET=$APP_SECRET
SEED_DEMO=$SEED_DEMO
EOF
    chmod 600 "$DEPLOY_DIR/.env"
    log "Generated fresh secrets in $DEPLOY_DIR/.env (mode 600)"
else
    log "Keeping existing $DEPLOY_DIR/.env (secrets unchanged)"
fi

# App bind: localhost-only when Caddy fronts it, otherwise exposed on :3000
if [[ -n "$DOMAIN" ]]; then APP_BIND="127.0.0.1:3000:3000"; else APP_BIND="3000:3000"; fi

cat > "$DEPLOY_DIR/docker-compose.yml" <<EOF
# Grain Tracker v2 — production stack (generated by gtv8-vps-setup.sh)
services:
  mysql:
    image: mysql:8
    container_name: grain-mysql
    restart: unless-stopped
    env_file: .env
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -u root -p\"\$\$MYSQL_ROOT_PASSWORD\" --silent"]
      interval: 5s
      timeout: 5s
      retries: 30
    networks: [grain-net]

  app:
    build:
      context: $REPO_DIR/app
    image: grain-tracker:latest
    container_name: grain-tracker
    restart: unless-stopped
    env_file: .env
    ports:
      - "$APP_BIND"
    depends_on:
      mysql:
        condition: service_healthy
    networks: [grain-net]

volumes:
  mysql-data:

networks:
  grain-net:
EOF

#-------------------------------------------------------------------------------
log "8/10  Building and starting Grain Tracker (this takes a few minutes)"
#-------------------------------------------------------------------------------
cd "$DEPLOY_DIR"
docker compose pull mysql
docker compose up -d --build

log "Waiting for the app to come up (migrations run on first boot)..."
for i in $(seq 1 36); do
    if curl -fsS -o /dev/null "http://127.0.0.1:3000" 2>/dev/null; then
        log "App is responding on port 3000."
        break
    fi
    sleep 5
    [[ $i -eq 36 ]] && warn "App not responding yet — check: docker logs -f grain-tracker"
done

#-------------------------------------------------------------------------------
log "9/10  systemd auto-start + update helper"
#-------------------------------------------------------------------------------
cat > /etc/systemd/system/grain-tracker.service <<EOF
[Unit]
Description=Grain Tracker v2 (Docker Compose stack)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$DEPLOY_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable grain-tracker.service

# Update helper: pull latest code from GitHub and rebuild
cat > /usr/local/sbin/grain-update <<EOF
#!/usr/bin/env bash
set -euo pipefail
git -C $REPO_DIR fetch --all
git -C $REPO_DIR checkout $GIT_BRANCH
git -C $REPO_DIR pull --ff-only origin $GIT_BRANCH
cd $DEPLOY_DIR
docker compose up -d --build
docker image prune -f
echo "Grain Tracker updated to latest $GIT_BRANCH."
EOF
chmod +x /usr/local/sbin/grain-update

#-------------------------------------------------------------------------------
log "10/10  Nightly database backups + optional HTTPS"
#-------------------------------------------------------------------------------
mkdir -p /var/backups/grain-tracker
chmod 700 /var/backups/grain-tracker
cat > /usr/local/sbin/grain-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/var/backups/grain-tracker
KEEP=__KEEP__
TS=$(date +%F_%H%M)
docker exec grain-mysql sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" graintracker' \
    | gzip > "$BACKUP_DIR/graintracker-$TS.sql.gz"
find "$BACKUP_DIR" -name 'graintracker-*.sql.gz' -mtime "+$KEEP" -delete
echo "Backup written: $BACKUP_DIR/graintracker-$TS.sql.gz"
EOF
sed -i "s/__KEEP__/$BACKUP_RETENTION_DAYS/" /usr/local/sbin/grain-backup
chmod +x /usr/local/sbin/grain-backup

cat > /etc/cron.d/grain-backup <<'EOF'
# Nightly Grain Tracker DB backup at 01:00
0 1 * * * root /usr/local/sbin/grain-backup >/var/log/grain-backup.log 2>&1
EOF

# --- Optional HTTPS via Caddy (required for USB scale from other computers) --
if [[ -n "$DOMAIN" ]]; then
    log "Installing Caddy for https://$DOMAIN"
    apt-get install -y caddy || {
        curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$(dpkg --print-architecture)" \
            -o /usr/bin/caddy && chmod +x /usr/bin/caddy
    }
    cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
EOF
    systemctl enable --now caddy
    systemctl reload caddy || systemctl restart caddy
fi

#===============================================================================
#  DONE
#===============================================================================
IP=$(curl -fsS4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
cat <<EOF

================================================================================
  GRAIN TRACKER v2 — VPS SETUP COMPLETE
================================================================================
  Server IP        : $IP
  Admin user       : $ADMIN_USER

  SSH (Bitvise / PuTTY):
      Host $IP   Port $SSH_PORT   User $ADMIN_USER

  GUI (XFCE4 remote desktop):
      Windows: mstsc -> $IP:3389   (login as $ADMIN_USER, session: Xorg)
$( [[ "$RDP_VIA_TUNNEL" == true ]] && echo "      Tunnel-only: ssh -L 3389:localhost:3389 $ADMIN_USER@$IP
      then mstsc -> localhost:3389" )

  Grain Tracker app:
$( if [[ -n "$DOMAIN" ]]; then
     echo "      URL  : https://$DOMAIN   (HTTPS — USB scale ready)"
   else
     echo "      URL  : http://$IP:3000"
     echo "      NOTE : plain HTTP — the USB scale button needs HTTPS or localhost."
     echo "             Set DOMAIN in this script and re-run to get HTTPS via Caddy."
   fi )
      Code : $REPO_DIR   (branch $GIT_BRANCH)
      Stack: $DEPLOY_DIR (docker-compose.yml + .env secrets)

  Day-to-day commands:
      docker logs -f grain-tracker        # live app logs
      docker ps                           # containers status
      sudo grain-update                   # pull GitHub + rebuild + restart
      sudo grain-backup                   # manual DB backup
      ls /var/backups/grain-tracker       # nightly backups (kept ${BACKUP_RETENTION_DAYS}d)
      sudo systemctl status grain-tracker # auto-start service

  First run in the app:
      Bins -> add your site + bins | Farmers & Lots -> add farmers, lots
      (See "Grain Tracker v2 — New Machine Startup Guide.md" in the repo, §4)

  SECURITY TODO:
      1. Verify you can SSH in as $ADMIN_USER, then rotate the password:
             passwd $ADMIN_USER
      2. Once an SSH key works for $ADMIN_USER, set DISABLE_PASSWORD_SSH=true
         in this script and re-run (safe/idempotent) to disable passwords.
      3. Copy backups off the VPS weekly (Bitvise SFTP works great for this).
================================================================================
EOF
