#!/usr/bin/env bash
#===============================================================================
#  VPS GRAIN TRACEABILITY STACK — One-shot setup for a fresh Ubuntu 24.04 VPS
#
#  What this script does:
#    1.  System update + essential tools (git, curl, htop, ufw, fail2ban, ...)
#    2.  Creates an admin user (optional) with sudo + docker rights
#    3.  Hardens the box: UFW firewall + fail2ban (SSH-safe defaults)
#    4.  Installs XFCE4 (light desktop) + XRDP (Remote Desktop server)
#    5.  Installs Docker CE + Docker Compose plugin (official Docker repo)
#    6.  Pulls YOUR grain traceability software from GitHub
#    7.  Builds & runs it with Docker (compose or plain Dockerfile)
#    8.  Registers a systemd unit so the app starts on every reboot
#
#  Usage (as root on a fresh Ubuntu 24.04):
#      nano vps-grain-stack-setup.sh        # 1) edit the CONFIG block below
#      chmod +x vps-grain-stack-setup.sh
#      ./vps-grain-stack-setup.sh           # 2) run it, grab a coffee
#
#  Connecting afterwards:
#    - SSH : Bitvise SSH Client / PuTTY -> <server-ip>:22 (user = ADMIN_USER)
#    - GUI : Windows "Remote Desktop Connection" (mstsc) -> <server-ip>:3389
#            Session: Xorg, user/password = ADMIN_USER / ADMIN_PASSWORD
#    - More secure GUI: keep RDP closed to the internet and tunnel it:
#            ssh -L 3389:localhost:3389 ADMIN_USER@<server-ip>
#            then point mstsc at  localhost:3389   (set RDP_VIA_TUNNEL=true)
#===============================================================================

set -euo pipefail
IFS=$'\n\t'

#===============================================================================
#  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>  CONFIG  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
#  Edit these values before running. Everything else is automatic.
#===============================================================================

# ---- Your grain traceability app -------------------------------------------
GIT_REPO_URL="https://github.com/kurtimas/GTv8Beta.git"
#   Examples:
#     Public : https://github.com/myuser/grain-traceability.git
#     Private (token): https://ghp_YourTokenHere@github.com/myuser/grain-traceability.git
#     Private (SSH)  : git@github.com:myuser/grain-traceability.git
#                      (requires USE_SSH_KEY=true below + deploy key on GitHub)

GIT_BRANCH="main"                 # branch to deploy (main / master / ...)
APP_DIR="/opt/GTv8Beta" # where the repo is cloned on the VPS
APP_PORT=""                       # e.g. "8080" -> opened in UFW if set; leave
                                  # empty to keep the app behind SSH only

# ---- Private repo via SSH deploy key (only if GIT_REPO_URL starts git@) ----
USE_SSH_KEY=false                 # true = generate a deploy key for GitHub

# ---- Admin user --------------------------------------------------------------
ADMIN_USER="vpsadmin"
ADMIN_PASSWORD="weliketoparty69"  # used for SSH + RDP login — CHANGE THIS

# ---- Remote desktop ----------------------------------------------------------
INSTALL_GUI=true                  # XFCE4 + XRDP
RDP_VIA_TUNNEL=false              # true = RDP reachable ONLY via SSH tunnel
                                  # (recommended once you are comfortable)

# ---- SSH hardening -----------------------------------------------------------
DISABLE_ROOT_SSH=true             # block direct root login over SSH
DISABLE_PASSWORD_SSH=false        # ONLY set true AFTER you copied an SSH key
                                  # for ADMIN_USER, or you lock yourself out!
SSH_PORT=22                       # change if you want a non-standard port

# ---- Locale / timezone -------------------------------------------------------
TIMEZONE="UTC"                    # e.g. "America/Chicago", "Europe/Berlin"

#===============================================================================
#  <<<<<<<<<<<<<<<<<<<<<<<<<<  END OF CONFIG  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
#===============================================================================

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m[error] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this script as root (sudo -i first)."

#-------------------------------------------------------------------------------
log "1/9  System update + essential packages"
#-------------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg lsb-release \
    git unzip zip tar jq htop net-tools \
    software-properties-common apt-transport-https \
    ufw fail2ban nano vim openssl

timedatectl set-timezone "$TIMEZONE" || warn "Timezone '$TIMEZONE' not applied"

#-------------------------------------------------------------------------------
log "2/9  Admin user: $ADMIN_USER"
#-------------------------------------------------------------------------------
if ! id "$ADMIN_USER" &>/dev/null; then
    adduser --disabled-password --gecos "" "$ADMIN_USER"
    echo "${ADMIN_USER}:${ADMIN_PASSWORD}" | chpasswd
    usermod -aG sudo "$ADMIN_USER"
    log "User '$ADMIN_USER' created."
else
    warn "User '$ADMIN_USER' already exists — skipping creation."
fi

# If you already have a public key for the admin user, drop it in and the
# script installs it (handy before enabling DISABLE_PASSWORD_SSH later):
if [[ -f /root/.ssh/authorized_keys && ! -s /home/$ADMIN_USER/.ssh/authorized_keys ]]; then
    mkdir -p /home/$ADMIN_USER/.ssh
    cp /root/.ssh/authorized_keys /home/$ADMIN_USER/.ssh/authorized_keys
    chown -R $ADMIN_USER:$ADMIN_USER /home/$ADMIN_USER/.ssh
    chmod 700 /home/$ADMIN_USER/.ssh
    chmod 600 /home/$ADMIN_USER/.ssh/authorized_keys
    log "Copied root's authorized_keys to $ADMIN_USER."
fi

#-------------------------------------------------------------------------------
log "3/9  Firewall (UFW) + fail2ban"
#-------------------------------------------------------------------------------
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp comment 'SSH'
if [[ "$INSTALL_GUI" == true && "$RDP_VIA_TUNNEL" == false ]]; then
    ufw allow 3389/tcp comment 'RDP (XFCE4 remote desktop)'
fi
[[ -n "$APP_PORT" ]] && ufw allow "$APP_PORT"/tcp comment 'Grain app'
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

#-------------------------------------------------------------------------------
log "4/9  SSH hardening"
#-------------------------------------------------------------------------------
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-vps-setup.conf <<EOF
Port $SSH_PORT
PermitRootLogin $( [[ "$DISABLE_ROOT_SSH" == true ]] && echo "no" || echo "prohibit-password" )
PasswordAuthentication $( [[ "$DISABLE_PASSWORD_SSH" == true ]] && echo "no" || echo "yes" )
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding yes
EOF
sshd -t && systemctl restart ssh
warn "SSH config written. Open a NEW session as $ADMIN_USER before closing this one!"

#-------------------------------------------------------------------------------
if [[ "$INSTALL_GUI" == true ]]; then
log "5/9  XFCE4 desktop + XRDP"
#-------------------------------------------------------------------------------
    # xubuntu-core pulls XFCE without the full Ubuntu desktop bloat.
    apt-get install -y --no-install-recommends \
        xorg xfce4 xfce4-terminal dbus-x11 \
        xrdp xorgxrdp \
        firefox-esr 2>/dev/null || \
    apt-get install -y --no-install-recommends \
        xorg xfce4 xfce4-terminal dbus-x11 xrdp xorgxrdp
    # ^ firefox-esr is not in Ubuntu's archive (snap only) — harmless fallback.

    # Make every RDP login start XFCE.
    echo "startxfce4" > /home/$ADMIN_USER/.xsession
    chown $ADMIN_USER:$ADMIN_USER /home/$ADMIN_USER/.xsession

    # Polkit: stop "Authentication is required to create a color profile" popups.
    mkdir -p /etc/polkit-1/localauthority/50-local.d
    cat > /etc/polkit-1/localauthority/50-local.d/45-allow-colord.pkla <<'EOF'
[Allow Colord all Users]
Identity=unix-user:*
Action=org.freedesktop.color-manager.create-device;org.freedesktop.color-manager.create-profile;org.freedesktop.color-manager.delete-device;org.freedesktop.color-manager.delete-profile;org.freedesktop.color-manager.modify-device;org.freedesktop.color-manager.modify-profile
ResultAny=no
ResultInactive=no
ResultActive=yes
EOF

    # xrdp needs the ssl-cert group to read its key.
    adduser xrdp ssl-cert >/dev/null 2>&1 || true

    # Slightly snappier session: use Xorg backend by default (already default
    # on Ubuntu 24.04 with xorgxrdp installed) and allow concurrent sessions.
    sed -i 's/^#\?max_sessions=.*/max_sessions=4/' /etc/xrdp/xrdp.ini || true

    systemctl enable --now xrdp
    systemctl restart xrdp
else
    log "5/9  GUI skipped (INSTALL_GUI=false)"
fi

#-------------------------------------------------------------------------------
log "6/9  Docker CE + Compose plugin"
#-------------------------------------------------------------------------------
if ! command -v docker &>/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
else
    warn "Docker already installed — skipping."
fi

systemctl enable --now docker
usermod -aG docker "$ADMIN_USER" || true

#-------------------------------------------------------------------------------
log "7/9  Cloning your grain traceability repo from GitHub"
#-------------------------------------------------------------------------------
# SSH deploy-key flow for private repos
if [[ "$USE_SSH_KEY" == true && "$GIT_REPO_URL" == git@* ]]; then
    DEPLOY_KEY=/root/.ssh/github_deploy_grain
    if [[ ! -f "$DEPLOY_KEY" ]]; then
        ssh-keygen -t ed25519 -C "vps-deploy-$(hostname)" -f "$DEPLOY_KEY" -N ""
    fi
    cat > /root/.ssh/config <<EOF
Host github.com
    HostName github.com
    IdentityFile $DEPLOY_KEY
    StrictHostKeyChecking accept-new
EOF
    chmod 600 /root/.ssh/config
    warn "=================================================================="
    warn " Add this DEPLOY KEY to your GitHub repo (Settings -> Deploy keys):"
    warn "------------------------------------------------------------------"
    cat "${DEPLOY_KEY}.pub"
    warn "=================================================================="
    warn "Press ENTER once the key is added on GitHub..."
    read -r _
fi

if [[ -d "$APP_DIR/.git" ]]; then
    log "Repo exists at $APP_DIR — pulling latest '$GIT_BRANCH'."
    git -C "$APP_DIR" fetch --all
    git -C "$APP_DIR" checkout "$GIT_BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$GIT_BRANCH"
else
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --branch "$GIT_BRANCH" --single-branch "$GIT_REPO_URL" "$APP_DIR"
fi

#-------------------------------------------------------------------------------
log "8/9  Building & starting the app with Docker"
#-------------------------------------------------------------------------------
cd "$APP_DIR"

if [[ -f docker-compose.yml || -f docker-compose.yaml || -f compose.yml || -f compose.yaml ]]; then
    COMPOSE_FILE=$(ls docker-compose.yml docker-compose.yaml compose.yml compose.yaml 2>/dev/null | head -n1)
    log "Found $COMPOSE_FILE -> docker compose up -d"
    docker compose -f "$COMPOSE_FILE" pull || true
    docker compose -f "$COMPOSE_FILE" up -d --build
    APP_CMD_UP="docker compose -f $APP_DIR/$COMPOSE_FILE up -d --build"
    APP_CMD_DOWN="docker compose -f $APP_DIR/$COMPOSE_FILE down"
elif [[ -f Dockerfile ]]; then
    log "Found Dockerfile -> docker build + run"
    docker build -t grain-traceability:latest .
    docker rm -f grain-traceability 2>/dev/null || true
    PORT_MAP=""
    [[ -n "$APP_PORT" ]] && PORT_MAP="-p ${APP_PORT}:${APP_PORT}"
    # shellcheck disable=SC2086
    docker run -d --name grain-traceability --restart unless-stopped \
        $PORT_MAP grain-traceability:latest
    APP_CMD_UP="docker start grain-traceability || docker run -d --name grain-traceability --restart unless-stopped $PORT_MAP grain-traceability:latest"
    APP_CMD_DOWN="docker stop grain-traceability"
else
    warn "No docker-compose.yml or Dockerfile found in $APP_DIR."
    warn "Repo is cloned — build/run it manually or add a Dockerfile."
    APP_CMD_UP=""
    APP_CMD_DOWN=""
fi

#-------------------------------------------------------------------------------
log "9/9  systemd auto-start on boot"
#-------------------------------------------------------------------------------
if [[ -n "$APP_CMD_UP" ]]; then
    cat > /etc/systemd/system/grain-traceability.service <<EOF
[Unit]
Description=Grain Traceability App (Docker)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash -lc '$APP_CMD_UP'
ExecStop=/bin/bash -lc '$APP_CMD_DOWN'
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable grain-traceability.service
fi

#===============================================================================
#  DONE — summary
#===============================================================================
IP=$(curl -fsS4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
cat <<EOF

========================================================================
  SETUP COMPLETE — VPS GRAIN TRACEABILITY STACK
========================================================================
  Server IP        : $IP
  Admin user       : $ADMIN_USER   (password: the one you set in CONFIG)

  SSH (Bitvise/PuTTY):
      Host: $IP    Port: $SSH_PORT    User: $ADMIN_USER

$( [[ "$INSTALL_GUI" == true ]] && cat <<GUI
  Remote Desktop (GUI):
      Windows: run  mstsc  ->  $IP:3389
      Login: $ADMIN_USER / <your ADMIN_PASSWORD>, Session: Xorg
$( [[ "$RDP_VIA_TUNNEL" == true ]] && echo "      NOTE: RDP is tunnel-only. First run:
        ssh -L 3389:localhost:3389 $ADMIN_USER@$IP
        then connect mstsc to  localhost:3389" )
GUI
)

  Application:
      Repo         : $GIT_REPO_URL ($GIT_BRANCH)
      Location     : $APP_DIR
      Auto-start   : systemctl status grain-traceability
$( [[ -n "$APP_PORT" ]] && echo "      App URL      : http://$IP:$APP_PORT" )

  Useful commands:
      cd $APP_DIR
      docker compose logs -f        # live app logs (compose apps)
      docker ps                     # running containers
      docker compose pull && docker compose up -d --build   # update app
      ufw status                    # firewall rules
      fail2ban-client status sshd   # banned IPs

  SECURITY TODO:
    1. You left SSH password login ENABLED. Once your SSH key works for
       $ADMIN_USER, set DISABLE_PASSWORD_SSH=true and re-run this script
       (or edit /etc/ssh/sshd_config.d/99-vps-setup.conf).
    2. Change ADMIN_PASSWORD in the script and rotate it on the box:
       passwd $ADMIN_USER
========================================================================
EOF
